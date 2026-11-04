import { COUNTER_KEYS, LIMITS, SHEETS } from '../../shared/constants.js';
import { manilaDateKey, manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type { ExpenseDto, Paginated, SessionUser } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';

/**
 * Money going out.
 *
 * Shaped like the Payments ledger on purpose — an amount, a method, a date and
 * a soft-delete Status — so what the shop spent can be summed the same way as
 * what it took, and the two put side by side.
 *
 * Nothing is ever deleted. A mistake is voided, which leaves the row in place
 * marked Cancelled, for the same reason a cancelled sale is kept.
 */

export function toExpenseDto(row: RowView): ExpenseDto {
  return {
    expenseId: row.get('Expense ID'),
    expenseDate: row.get('Expense Date'),
    category: row.get('Category') || 'Other',
    description: row.get('Description'),
    amount: row.num('Amount'),
    modeOfPayment: row.get('Mode of Payment') || 'Cash',
    paidTo: row.get('Paid To'),
    reference: row.get('Reference'),
    itemId: row.get('Item ID'),
    recordedBy: row.get('Recorded By'),
    status: row.get('Status') === 'Cancelled' ? 'Cancelled' : 'Active',
    notes: row.get('Notes'),
    createdAt: row.get('Created At'),
    updatedAt: row.get('Updated At'),
  };
}

async function expensesTable(fresh = false) {
  return getStore().table(SHEETS.expenses, fresh ? { fresh: true } : {});
}

export interface ExpenseQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  from?: string;
  to?: string;
  includeCancelled?: boolean;
}

export async function listExpenses(query: ExpenseQuery = {}): Promise<Paginated<ExpenseDto>> {
  const table = await expensesTable();
  const needle = query.search?.trim().toLowerCase();
  const pageSize = Math.min(query.pageSize ?? LIMITS.defaultPageSize, LIMITS.maxPageSize);

  const items = table.rows
    .map(toExpenseDto)
    .filter((expense) => {
      if (!query.includeCancelled && expense.status !== 'Active') return false;
      if (query.category && expense.category !== query.category) return false;

      // Dates are compared as Manila day keys, the same way sales are bucketed,
      // so a day's takings and a day's spending cover the same hours.
      const dateKey = expense.expenseDate.slice(0, 10);
      if (query.from && dateKey < query.from) return false;
      if (query.to && dateKey > query.to) return false;

      if (needle) {
        const haystack = (
          expense.description + ' ' + expense.paidTo + ' ' + expense.category + ' ' + expense.reference
        ).toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;

  return { items: items.slice(start, start + pageSize), page, pageSize, total, totalPages };
}

export interface CreateExpenseInput {
  category: string;
  description: string;
  amount: number;
  modeOfPayment?: string;
  paidTo?: string;
  reference?: string;
  itemId?: string;
  expenseDate?: string;
  notes?: string;
}

export async function createExpense(
  input: CreateExpenseInput,
  actor: SessionUser,
): Promise<ExpenseDto> {
  const description = normaliseText(input.description, 160);
  if (description.length < 2) throw badRequest('Describe what the money was spent on.');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('Enter an amount greater than zero.');
  }
  if (amount > LIMITS.maxExpenseAmount) throw badRequest('That amount is out of range.');

  return withNamedLock('expenses:write', async () => {
    const store = getStore();
    const expenseId = await nextEntityId(
      COUNTER_KEYS.expenseId,
      'EXP-',
      SHEETS.expenses,
      'Expense ID',
      6,
    );
    const timestamp = manilaIso();
    const dateKey = input.expenseDate?.trim() || manilaDateKey();

    await store.appendRecords(SHEETS.expenses, [
      {
        'Expense ID': expenseId,
        'Expense Date': dateKey,
        Category: normaliseText(input.category, 40) || 'Other',
        Description: description,
        // Stored to two decimals like every other money column, so the sheet
        // adds up by eye as well as in code.
        Amount: toPesos(toCentavos(amount)).toFixed(2),
        'Mode of Payment': input.modeOfPayment === 'GCash' ? 'GCash' : 'Cash',
        'Paid To': normaliseText(input.paidTo, 80),
        Reference: normaliseText(input.reference, 80),
        'Item ID': normaliseText(input.itemId, 20),
        'Recorded By': actor.username,
        Status: 'Active',
        Notes: normaliseText(input.notes, LIMITS.maxNotesLength),
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'EXPENSE_CREATE',
      module: 'Expenses',
      entityId: expenseId,
      newValue: { category: input.category, amount, description },
    });

    const created = (await expensesTable(true)).find(
      (row) => row.get('Expense ID') === expenseId,
    );
    if (!created) throw notFound('The new expense');
    return toExpenseDto(created);
  });
}

export interface UpdateExpenseInput {
  category?: string;
  description?: string;
  amount?: number;
  modeOfPayment?: string;
  paidTo?: string;
  expenseDate?: string;
  notes?: string;
}

export async function updateExpense(
  expenseId: string,
  input: UpdateExpenseInput,
  actor: SessionUser,
): Promise<ExpenseDto> {
  return withNamedLock('expenses:write', async () => {
    const store = getStore();
    const table = await expensesTable(true);
    const row = table.find((candidate) => candidate.get('Expense ID') === expenseId);
    if (!row) throw notFound('Expense');

    const before = toExpenseDto(row);
    if (before.status === 'Cancelled') throw conflict('This expense has been voided.');

    const patch: Record<string, string> = { 'Updated At': manilaIso() };
    if (input.category !== undefined) patch.Category = normaliseText(input.category, 40);
    if (input.description !== undefined) {
      const description = normaliseText(input.description, 160);
      if (description.length < 2) throw badRequest('Describe what the money was spent on.');
      patch.Description = description;
    }
    if (input.amount !== undefined) {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw badRequest('Enter an amount greater than zero.');
      }
      if (amount > LIMITS.maxExpenseAmount) throw badRequest('That amount is out of range.');
      patch.Amount = toPesos(toCentavos(amount)).toFixed(2);
    }
    if (input.modeOfPayment !== undefined) {
      patch['Mode of Payment'] = input.modeOfPayment === 'GCash' ? 'GCash' : 'Cash';
    }
    if (input.paidTo !== undefined) patch['Paid To'] = normaliseText(input.paidTo, 80);
    if (input.expenseDate !== undefined) patch['Expense Date'] = input.expenseDate;
    if (input.notes !== undefined) patch.Notes = normaliseText(input.notes, LIMITS.maxNotesLength);

    await store.updateRecord(SHEETS.expenses, row, patch);

    await recordAudit({
      actor,
      action: 'EXPENSE_UPDATE',
      module: 'Expenses',
      entityId: expenseId,
      previousValue: { amount: before.amount, category: before.category },
      newValue: patch,
    });

    const updated = (await expensesTable(true)).find(
      (candidate) => candidate.get('Expense ID') === expenseId,
    );
    if (!updated) throw notFound('Expense');
    return toExpenseDto(updated);
  });
}

/**
 * Void an expense. The row is kept and marked Cancelled rather than removed,
 * so a corrected mistake still leaves a trail.
 */
export async function voidExpense(
  expenseId: string,
  reason: string,
  actor: SessionUser,
): Promise<ExpenseDto> {
  return withNamedLock('expenses:write', async () => {
    const store = getStore();
    const table = await expensesTable(true);
    const row = table.find((candidate) => candidate.get('Expense ID') === expenseId);
    if (!row) throw notFound('Expense');

    const before = toExpenseDto(row);
    if (before.status === 'Cancelled') return before;

    await store.updateRecord(SHEETS.expenses, row, {
      Status: 'Cancelled',
      Notes: normaliseText(
        (before.notes + ' | Voided: ' + reason).trim(),
        LIMITS.maxNotesLength,
      ),
      'Updated At': manilaIso(),
    });

    await recordAudit({
      actor,
      action: 'EXPENSE_VOID',
      module: 'Expenses',
      entityId: expenseId,
      previousValue: { amount: before.amount, status: 'Active' },
      newValue: { status: 'Cancelled', reason },
    });

    const updated = (await expensesTable(true)).find(
      (candidate) => candidate.get('Expense ID') === expenseId,
    );
    return updated ? toExpenseDto(updated) : before;
  });
}

/** Active expenses in a date range, in centavos, grouped by category. */
export async function expenseTotals(
  from: string,
  to: string,
): Promise<{ totalC: number; count: number; byCategory: Map<string, number> }> {
  // Read the table directly rather than going through listExpenses: that
  // paginates, and a total taken from one page of results would be wrong.
  const table = await expensesTable();
  const byCategory = new Map<string, number>();
  let totalC = 0;
  let count = 0;

  for (const row of table.rows) {
    const expense = toExpenseDto(row);
    if (expense.status !== 'Active') continue;
    const dateKey = expense.expenseDate.slice(0, 10);
    if (from && dateKey < from) continue;
    if (to && dateKey > to) continue;

    const amountC = toCentavos(expense.amount);
    totalC += amountC;
    count += 1;
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + amountC);
  }

  return { totalC, count, byCategory };
}
