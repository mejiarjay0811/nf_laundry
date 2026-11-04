import { COUNTER_KEYS, SHEETS } from '../../shared/constants.js';
import { countsTowardSales } from '../../shared/calc.js';
import { manilaDateKey, manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type { CustomerDto, CustomerStatsDto, Paginated, SessionUser } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView, SheetTable } from '../sheets/table.js';
import { comparisonKey, normaliseContact, normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';

export interface CustomerRecord extends CustomerDto {
  row: RowView;
}

function toRecord(row: RowView): CustomerRecord {
  return {
    customerId: row.get('Customer ID'),
    fullName: row.get('Full Name'),
    address: row.get('Address'),
    contactNumber: row.get('Contact Number'),
    registrationDate: row.get('Registration Date'),
    totalTransactions: row.num('Total Transactions'),
    totalSpending: row.num('Total Spending'),
    lastTransactionDate: row.get('Last Transaction Date') || null,
    status: row.get('Status') === 'Inactive' ? 'Inactive' : 'Active',
    notes: row.get('Notes'),
    createdAt: row.get('Created At'),
    updatedAt: row.get('Updated At'),
    row,
  };
}

export function toCustomerDto(record: CustomerRecord): CustomerDto {
  const { row: _row, ...dto } = record;
  return dto;
}

export async function getCustomerRecord(customerId: string): Promise<CustomerRecord | null> {
  const table = await getStore().table(SHEETS.customers);
  const row = table.find((candidate) => candidate.get('Customer ID') === customerId);
  return row ? toRecord(row) : null;
}

export async function getCustomer(customerId: string): Promise<CustomerDto> {
  const record = await getCustomerRecord(customerId);
  if (!record) throw notFound('Customer');
  return toCustomerDto(record);
}

export interface CustomerQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: 'Active' | 'Inactive';
  sortBy?: 'name' | 'recent' | 'spending' | 'transactions';
}

export async function listCustomers(query: CustomerQuery): Promise<Paginated<CustomerDto>> {
  const table = await getStore().table(SHEETS.customers);
  let items = table.rows.map(toRecord).map(toCustomerDto);

  if (query.status) items = items.filter((c) => c.status === query.status);

  const search = query.search?.trim().toLowerCase();
  if (search) {
    const digits = search.replace(/\D/g, '');
    items = items.filter((c) => {
      if (c.fullName.toLowerCase().includes(search)) return true;
      if (c.customerId.toLowerCase().includes(search)) return true;
      if (digits && c.contactNumber.replace(/\D/g, '').includes(digits)) return true;
      return false;
    });
  }

  switch (query.sortBy) {
    case 'spending':
      items.sort((a, b) => b.totalSpending - a.totalSpending);
      break;
    case 'transactions':
      items.sort((a, b) => b.totalTransactions - a.totalTransactions);
      break;
    case 'recent':
      items.sort((a, b) => (b.lastTransactionDate ?? '').localeCompare(a.lastTransactionDate ?? ''));
      break;
    case 'name':
    default:
      items.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(Math.max(1, query.page), totalPages);
  const start = (page - 1) * query.pageSize;

  return {
    items: items.slice(start, start + query.pageSize),
    page,
    pageSize: query.pageSize,
    total,
    totalPages,
  };
}

/**
 * Duplicate rules for a new customer, in two tiers.
 *
 * HARD (always rejected): the same contact number already exists. A phone
 * number identifies a person, so this is the same customer being entered twice.
 *
 * SOFT (rejected once, then overridable): the same name with no number to tell
 * them apart. Two different Maria Santos walking in is entirely possible, so
 * the cashier is warned and can confirm — but not by accident.
 */
export function assertNotDuplicate(
  table: SheetTable,
  fullName: string,
  contactNumber: string,
  allowDuplicateName?: boolean,
): void {
  if (contactNumber) {
    const clash = table.find(
      (row) => normaliseContact(row.get('Contact Number')) === contactNumber,
    );
    if (clash) {
      throw conflict(
        'That contact number already belongs to ' + clash.get('Full Name') + '.',
        { customerId: clash.get('Customer ID'), reason: 'contact' },
      );
    }
    return;
  }

  if (allowDuplicateName) return;

  const nameKey = comparisonKey(fullName);
  const sameName = table.find((row) => comparisonKey(row.get('Full Name')) === nameKey);
  if (sameName) {
    throw conflict(
      'A customer named ' + sameName.get('Full Name') + ' already exists. ' +
        'Add a contact number to tell them apart, or confirm to register anyway.',
      {
        customerId: sameName.get('Customer ID'),
        reason: 'name',
        overridable: true,
      },
    );
  }
}

export interface CreateCustomerInput {
  fullName: string;
  address?: string;
  /** Optional — plenty of walk-ins do not leave a number. */
  contactNumber?: string;
  notes?: string;
  /** Confirms registering a second customer with the same name. */
  allowDuplicateName?: boolean;
}

/** Create a customer. See assertNotDuplicate for the duplicate rules. */
export async function createCustomer(
  input: CreateCustomerInput,
  actor: SessionUser,
  options: { allowDuplicate?: boolean } = {},
): Promise<CustomerDto> {
  const fullName = normaliseText(input.fullName, 80);
  const contactNumber = normaliseContact(input.contactNumber);
  const address = normaliseText(input.address, 160);
  const notes = normaliseText(input.notes, 500);

  if (fullName.length < 2) throw badRequest('Customer name is required.');
  if (contactNumber && contactNumber.replace(/\D/g, '').length < 7) {
    throw badRequest('Please enter a valid contact number, or leave it blank.');
  }

  return withNamedLock('customers:write', async () => {
    const store = getStore();
    const table = await store.table(SHEETS.customers, { fresh: true });

    if (!options.allowDuplicate) {
      // Same two-tier rule the POS uses, so a customer registered from either
      // screen is checked identically.
      assertNotDuplicate(table, fullName, contactNumber, input.allowDuplicateName);
    }

    const customerId = await nextEntityId(
      COUNTER_KEYS.customerId,
      'CUST-',
      SHEETS.customers,
      'Customer ID',
      5,
    );
    const timestamp = manilaIso();

    await store.appendRecords(SHEETS.customers, [
      {
        'Customer ID': customerId,
        'Full Name': fullName,
        Address: address,
        'Contact Number': contactNumber,
        'Registration Date': manilaDateKey(),
        'Total Transactions': '0',
        'Total Spending': '0.00',
        'Last Transaction Date': '',
        Status: 'Active',
        Notes: notes,
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'CUSTOMER_CREATE',
      module: 'Customers',
      entityId: customerId,
      newValue: { fullName, contactNumber, address },
    });

    const created = await getCustomerRecord(customerId);
    if (!created) throw notFound('The new customer');
    return toCustomerDto(created);
  });
}

export interface UpdateCustomerInput {
  fullName?: string;
  address?: string;
  contactNumber?: string;
  notes?: string;
  status?: 'Active' | 'Inactive';
}

export async function updateCustomer(
  customerId: string,
  input: UpdateCustomerInput,
  actor: SessionUser,
): Promise<CustomerDto> {
  return withNamedLock('customers:write', async () => {
    const store = getStore();
    const record = await getCustomerRecord(customerId);
    if (!record) throw notFound('Customer');

    const patch: Record<string, string> = { 'Updated At': manilaIso() };

    if (input.fullName !== undefined) {
      const fullName = normaliseText(input.fullName, 80);
      if (fullName.length < 2) throw badRequest('Customer name is required.');
      patch['Full Name'] = fullName;
    }
    if (input.contactNumber !== undefined) {
      const contact = normaliseContact(input.contactNumber);
      if (contact.replace(/\D/g, '').length < 7) {
        throw badRequest('Please enter a valid contact number.');
      }
      patch['Contact Number'] = contact;
    }
    if (input.address !== undefined) patch.Address = normaliseText(input.address, 160);
    if (input.notes !== undefined) patch.Notes = normaliseText(input.notes, 500);
    if (input.status !== undefined) patch.Status = input.status;

    await store.updateRecord(SHEETS.customers, record.row, patch);

    await recordAudit({
      actor,
      action: 'CUSTOMER_UPDATE',
      module: 'Customers',
      entityId: customerId,
      previousValue: {
        fullName: record.fullName,
        contactNumber: record.contactNumber,
        address: record.address,
        status: record.status,
      },
      newValue: input,
    });

    const updated = await getCustomerRecord(customerId);
    if (!updated) throw notFound('Customer');
    return toCustomerDto(updated);
  });
}

/**
 * Recompute a customer's rollups directly from the Transactions sheet.
 *
 * The Customers sheet keeps these figures only as a convenience for people
 * reading the workbook; transactions remain the single source of truth, so the
 * numbers can never drift out of agreement with the reports.
 */
export async function refreshCustomerStatistics(customerId: string): Promise<void> {
  const store = getStore();
  const [customers, transactions] = await Promise.all([
    store.table(SHEETS.customers),
    store.table(SHEETS.transactions),
  ]);

  const row = customers.find((candidate) => candidate.get('Customer ID') === customerId);
  if (!row) return;

  let count = 0;
  let spendingC = 0;
  let lastDate = '';

  for (const transaction of transactions.rows) {
    if (transaction.get('Customer ID') !== customerId) continue;
    const paymentStatus = transaction.get('Payment Status');
    if (!countsTowardSales(transaction.get('Status'), paymentStatus as never)) continue;

    count += 1;
    spendingC += toCentavos(transaction.num('Total Payment'));
    const date = transaction.get('Transaction Date');
    if (date > lastDate) lastDate = date;
  }

  await store.updateRecord(SHEETS.customers, row, {
    'Total Transactions': String(count),
    'Total Spending': toPesos(spendingC).toFixed(2),
    'Last Transaction Date': lastDate,
    'Updated At': manilaIso(),
  });
}

/** Live profile statistics, computed from transactions rather than rollups. */
export async function getCustomerStats(customerId: string): Promise<CustomerStatsDto> {
  const transactions = await getStore().table(SHEETS.transactions);

  let totalTransactions = 0;
  let spendingC = 0;
  let outstandingC = 0;
  let activeOrders = 0;
  let lastTransactionDate: string | null = null;
  const serviceCounts = new Map<string, number>();

  for (const row of transactions.rows) {
    if (row.get('Customer ID') !== customerId) continue;
    const recordStatus = row.get('Status');
    const paymentStatus = row.get('Payment Status');
    const orderStatus = row.get('Order Status');

    if (orderStatus !== 'Picked Up' && orderStatus !== 'Cancelled' && recordStatus === 'Active') {
      activeOrders += 1;
    }
    if (!countsTowardSales(recordStatus, paymentStatus as never)) continue;

    totalTransactions += 1;
    spendingC += toCentavos(row.num('Total Payment'));
    outstandingC += toCentavos(row.num('Balance'));

    const service = row.get('Service Type');
    if (service) serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);

    const date = row.get('Transaction Date');
    if (!lastTransactionDate || date > lastTransactionDate) lastTransactionDate = date;
  }

  let favouriteService: string | null = null;
  let best = 0;
  for (const [service, count] of serviceCounts) {
    if (count > best) {
      best = count;
      favouriteService = service;
    }
  }

  return {
    totalTransactions,
    totalSpending: toPesos(spendingC),
    outstandingBalance: toPesos(outstandingC),
    activeOrders,
    lastTransactionDate,
    favouriteService,
  };
}

/**
 * Address suggestions drawn from customers already on file.
 *
 * A laundry serves the same few streets over and over, so the addresses the
 * shop has already typed are far better suggestions than a generic map
 * lookup would give — and this needs no API key, no billing account and no
 * network call. (A Places-style lookup can be layered on top later; see the
 * README for what that would take.)
 */
export async function suggestAddresses(term: string, limit = 6): Promise<string[]> {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];

  const table = await getStore().table(SHEETS.customers);
  const seen = new Map<string, string>();

  for (const row of table.rows) {
    const address = row.get('Address').trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    if (key.includes(needle)) seen.set(key, address);
    if (seen.size >= limit) break;
  }

  return [...seen.values()].sort((a, b) => {
    // Prefer addresses that START with what was typed.
    const aStarts = a.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.toLowerCase().startsWith(needle) ? 0 : 1;
    return aStarts - bStarts || a.localeCompare(b);
  });
}

/** Fast type-ahead lookup used by the POS customer picker. */
export async function searchCustomers(term: string, limit = 8): Promise<CustomerDto[]> {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];

  const table = await getStore().table(SHEETS.customers);
  const digits = needle.replace(/\D/g, '');
  const matches: CustomerDto[] = [];

  for (const row of table.rows) {
    if (row.get('Status') === 'Inactive') continue;
    const name = row.get('Full Name').toLowerCase();
    const contact = row.get('Contact Number').replace(/\D/g, '');
    const id = row.get('Customer ID').toLowerCase();

    if (name.includes(needle) || id.includes(needle) || (digits && contact.includes(digits))) {
      matches.push(toCustomerDto(toRecord(row)));
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
