import {
  COUNTER_KEYS,
  LIMITS,
  SHEETS,
  type StockMovement,
} from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type {
  InventoryItemDto,
  Paginated,
  SessionUser,
  StockMovementDto,
} from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { comparisonKey, normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { createExpense, voidExpense } from './expense.service.js';
import { nextEntityId } from './sequence.service.js';

/**
 * What the shop keeps on the shelf.
 *
 * The quantity on an item is a running balance, and every change to it also
 * writes a row to StockMovements. That is the point of the design: a count that
 * is only ever overwritten cannot be checked, whereas a balance with a movement
 * behind each change can be reconciled against what actually happened.
 *
 * Restocking optionally books itself as an expense, so buying detergent shows
 * up in the month's spending without anyone having to remember to enter it
 * twice.
 */

export function toInventoryDto(row: RowView): InventoryItemDto {
  const quantity = row.num('Quantity');
  const unitCost = row.num('Unit Cost');
  const reorderLevel = row.num('Reorder Level');

  return {
    itemId: row.get('Item ID'),
    name: row.get('Name'),
    category: row.get('Category') || 'Other',
    unit: row.get('Unit') || 'pc',
    quantity,
    unitCost,
    reorderLevel,
    supplier: row.get('Supplier'),
    status: row.get('Status') === 'Inactive' ? 'Inactive' : 'Active',
    notes: row.get('Notes'),
    stockValue: toPesos(Math.round(quantity * toCentavos(unitCost))),
    lowStock: reorderLevel > 0 && quantity <= reorderLevel,
    createdAt: row.get('Created At'),
    updatedAt: row.get('Updated At'),
  };
}

function toMovementDto(row: RowView): StockMovementDto {
  return {
    movementId: row.get('Movement ID'),
    itemId: row.get('Item ID'),
    itemName: row.get('Item Name'),
    type: row.get('Type'),
    quantity: row.num('Quantity'),
    unitCost: row.num('Unit Cost'),
    totalCost: row.num('Total Cost'),
    balanceAfter: row.num('Balance After'),
    expenseId: row.get('Expense ID'),
    reason: row.get('Reason'),
    recordedBy: row.get('Recorded By'),
    movementDate: row.get('Movement Date'),
  };
}

async function inventoryTable(fresh = false) {
  return getStore().table(SHEETS.inventory, fresh ? { fresh: true } : {});
}

async function findItemRow(itemId: string): Promise<RowView | null> {
  const table = await inventoryTable(true);
  return table.find((row) => row.get('Item ID') === itemId) ?? null;
}

export interface InventoryQuery {
  search?: string;
  category?: string;
  lowStockOnly?: boolean;
  includeInactive?: boolean;
}

export async function listInventory(query: InventoryQuery = {}): Promise<InventoryItemDto[]> {
  const table = await inventoryTable();
  const needle = query.search?.trim().toLowerCase();

  return table.rows
    .map(toInventoryDto)
    .filter((item) => {
      if (!query.includeInactive && item.status !== 'Active') return false;
      if (query.category && item.category !== query.category) return false;
      if (query.lowStockOnly && !item.lowStock) return false;
      if (needle) {
        const haystack = (item.name + ' ' + item.category + ' ' + item.supplier).toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Anything needing a reorder floats to the top; that is the reason to
      // open this screen at all.
      if (a.lowStock !== b.lowStock) return a.lowStock ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function getInventoryItem(itemId: string): Promise<InventoryItemDto> {
  const row = await findItemRow(itemId);
  if (!row) throw notFound('Inventory item');
  return toInventoryDto(row);
}

export interface CreateInventoryInput {
  name: string;
  category: string;
  unit: string;
  quantity?: number;
  unitCost?: number;
  reorderLevel?: number;
  supplier?: string;
  notes?: string;
}

export async function createInventoryItem(
  input: CreateInventoryInput,
  actor: SessionUser,
): Promise<InventoryItemDto> {
  const name = normaliseText(input.name, 80);
  if (name.length < 2) throw badRequest('Enter the item name.');

  return withNamedLock('inventory:write', async () => {
    const store = getStore();
    const table = await inventoryTable(true);

    // Two rows for the same thing make the stock figure meaningless.
    const key = comparisonKey(name);
    if (table.rows.some((row) => comparisonKey(row.get('Name')) === key)) {
      throw conflict('An item called "' + name + '" already exists.');
    }

    const itemId = await nextEntityId(
      COUNTER_KEYS.inventoryId,
      'INV-',
      SHEETS.inventory,
      'Item ID',
      5,
    );
    const timestamp = manilaIso();
    const quantity = Math.max(0, Number(input.quantity) || 0);

    await store.appendRecords(SHEETS.inventory, [
      {
        'Item ID': itemId,
        Name: name,
        Category: normaliseText(input.category, 40) || 'Other',
        Unit: normaliseText(input.unit, 20) || 'pc',
        Quantity: String(quantity),
        'Unit Cost': (Number(input.unitCost) || 0).toFixed(2),
        'Reorder Level': String(Math.max(0, Number(input.reorderLevel) || 0)),
        Supplier: normaliseText(input.supplier, 80),
        Status: 'Active',
        Notes: normaliseText(input.notes, LIMITS.maxNotesLength),
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    // An opening balance is still a movement, so the history starts complete.
    if (quantity > 0) {
      await appendMovement({
        itemId,
        itemName: name,
        type: 'Correction',
        quantity,
        unitCost: Number(input.unitCost) || 0,
        balanceAfter: quantity,
        expenseId: '',
        reason: 'Opening stock',
        actor,
      });
    }

    await recordAudit({
      actor,
      action: 'INVENTORY_CREATE',
      module: 'Inventory',
      entityId: itemId,
      newValue: { name, quantity },
    });

    return getInventoryItem(itemId);
  });
}

export interface UpdateInventoryInput {
  name?: string;
  category?: string;
  unit?: string;
  unitCost?: number;
  reorderLevel?: number;
  supplier?: string;
  notes?: string;
  status?: 'Active' | 'Inactive';
}

/**
 * Edit an item's details. Deliberately cannot change the quantity — that only
 * moves through recordStockMovement, so the balance and its history can never
 * disagree.
 */
export async function updateInventoryItem(
  itemId: string,
  input: UpdateInventoryInput,
  actor: SessionUser,
): Promise<InventoryItemDto> {
  return withNamedLock('inventory:write', async () => {
    const store = getStore();
    const row = await findItemRow(itemId);
    if (!row) throw notFound('Inventory item');
    const before = toInventoryDto(row);

    const patch: Record<string, string> = { 'Updated At': manilaIso() };
    if (input.name !== undefined) {
      const name = normaliseText(input.name, 80);
      if (name.length < 2) throw badRequest('Enter the item name.');
      patch.Name = name;
    }
    if (input.category !== undefined) patch.Category = normaliseText(input.category, 40);
    if (input.unit !== undefined) patch.Unit = normaliseText(input.unit, 20);
    if (input.unitCost !== undefined) patch['Unit Cost'] = (Number(input.unitCost) || 0).toFixed(2);
    if (input.reorderLevel !== undefined) {
      patch['Reorder Level'] = String(Math.max(0, Number(input.reorderLevel) || 0));
    }
    if (input.supplier !== undefined) patch.Supplier = normaliseText(input.supplier, 80);
    if (input.notes !== undefined) patch.Notes = normaliseText(input.notes, LIMITS.maxNotesLength);
    if (input.status !== undefined) patch.Status = input.status;

    await store.updateRecord(SHEETS.inventory, row, patch);

    await recordAudit({
      actor,
      action: 'INVENTORY_UPDATE',
      module: 'Inventory',
      entityId: itemId,
      previousValue: { name: before.name, unitCost: before.unitCost, status: before.status },
      newValue: patch,
    });

    return getInventoryItem(itemId);
  });
}

/* ------------------------------------------------------------- movements */

async function appendMovement(input: {
  itemId: string;
  itemName: string;
  type: StockMovement;
  quantity: number;
  unitCost: number;
  balanceAfter: number;
  expenseId: string;
  reason: string;
  actor: SessionUser;
}): Promise<string> {
  const movementId = await nextEntityId(
    COUNTER_KEYS.stockMovementId,
    'STK-',
    SHEETS.stockMovements,
    'Movement ID',
    6,
  );
  const timestamp = manilaIso();

  await getStore().appendRecords(SHEETS.stockMovements, [
    {
      'Movement ID': movementId,
      'Item ID': input.itemId,
      'Item Name': input.itemName,
      Type: input.type,
      Quantity: String(input.quantity),
      'Unit Cost': input.unitCost.toFixed(2),
      'Total Cost': toPesos(Math.round(input.quantity * toCentavos(input.unitCost))).toFixed(2),
      'Balance After': String(input.balanceAfter),
      'Expense ID': input.expenseId,
      Reason: normaliseText(input.reason, 200),
      'Recorded By': input.actor.username,
      'Movement Date': timestamp,
      'Created At': timestamp,
    },
  ]);

  return movementId;
}

export interface StockMovementInput {
  type: StockMovement;
  quantity: number;
  /** Restock only: what it cost, which also updates the item's unit cost. */
  unitCost?: number;
  /** Restock only: also record the purchase as an expense. */
  recordExpense?: boolean;
  reason?: string;
}

export interface StockMovementResult {
  item: InventoryItemDto;
  movementId: string;
  expenseId: string | null;
}

/**
 * Move stock in or out.
 *
 * Restock adds; everything else takes away. The balance is never allowed below
 * zero — a count that has gone negative is a data-entry mistake, and silently
 * accepting it would hide the mistake rather than surface it.
 */
export async function recordStockMovement(
  itemId: string,
  input: StockMovementInput,
  actor: SessionUser,
): Promise<StockMovementResult> {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw badRequest('Enter a quantity greater than zero.');
  }
  if (quantity > LIMITS.maxStockQuantity) throw badRequest('That quantity is out of range.');

  return withNamedLock('inventory:write', async () => {
    const store = getStore();
    const row = await findItemRow(itemId);
    if (!row) throw notFound('Inventory item');
    const item = toInventoryDto(row);

    const isRestock = input.type === 'Restock';
    const delta = isRestock ? quantity : -quantity;
    const balanceAfter = item.quantity + delta;

    if (balanceAfter < 0) {
      throw conflict(
        'There are only ' + item.quantity + ' ' + item.unit + ' of ' + item.name +
          ' on record, so ' + quantity + ' cannot be taken out.',
      );
    }

    const unitCost = isRestock && input.unitCost !== undefined
      ? Number(input.unitCost) || 0
      : item.unitCost;

    /*
     * The expense is written before the stock moves. If the stock update then
     * fails the expense is voided; the reverse order could leave stock that was
     * never paid for, which is the harder error to notice.
     */
    let expenseId: string | null = null;
    if (isRestock && input.recordExpense) {
      const cost = toPesos(Math.round(quantity * toCentavos(unitCost)));
      if (cost > 0) {
        const expense = await createExpense(
          {
            category: 'Supplies',
            description: 'Restock: ' + item.name + ' (' + quantity + ' ' + item.unit + ')',
            amount: cost,
            modeOfPayment: 'Cash',
            itemId: item.itemId,
            reference: item.supplier,
          },
          actor,
        );
        expenseId = expense.expenseId;
      }
    }

    try {
      const patch: Record<string, string> = {
        Quantity: String(balanceAfter),
        'Updated At': manilaIso(),
      };
      if (isRestock && input.unitCost !== undefined) patch['Unit Cost'] = unitCost.toFixed(2);
      await store.updateRecord(SHEETS.inventory, row, patch);
    } catch (error) {
      if (expenseId) await voidExpense(expenseId, 'Stock update failed', actor).catch(() => undefined);
      throw error;
    }

    const movementId = await appendMovement({
      itemId: item.itemId,
      itemName: item.name,
      type: input.type,
      quantity,
      unitCost,
      balanceAfter,
      expenseId: expenseId ?? '',
      reason: input.reason ?? '',
      actor,
    });

    await recordAudit({
      actor,
      action: 'INVENTORY_MOVEMENT',
      module: 'Inventory',
      entityId: item.itemId,
      previousValue: { quantity: item.quantity },
      newValue: { type: input.type, quantity, balanceAfter, expenseId },
    });

    return { item: await getInventoryItem(itemId), movementId, expenseId };
  });
}

export async function listStockMovements(
  itemId?: string,
  page = 1,
  pageSize = 25,
): Promise<Paginated<StockMovementDto>> {
  const table = await getStore().table(SHEETS.stockMovements);
  const items = table.rows
    .map(toMovementDto)
    .filter((movement) => !itemId || movement.itemId === itemId)
    .sort((a, b) => b.movementDate.localeCompare(a.movementDate));

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageSize,
    total,
    totalPages,
  };
}

/** Items at or below their reorder level, for the dashboard and alerts. */
export async function lowStockItems(): Promise<InventoryItemDto[]> {
  return listInventory({ lowStockOnly: true });
}
