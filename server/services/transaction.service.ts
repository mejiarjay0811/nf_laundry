import {
  SHEETS,
  normaliseOrderStatus,
  type PaymentStatus,
} from '../../shared/constants.js';
import {
  computeTransactionMoney,
  derivePaymentStatus,
  derivePickupStatus,
} from '../../shared/calc.js';
import { manilaDateKey, manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type { Paginated, TransactionDto } from '../../shared/types.js';
import { getStore } from '../sheets/index.js';
import type { RowView, SheetTable } from '../sheets/table.js';
import { withNamedLock } from '../utils/mutex.js';

export interface TransactionRecord extends TransactionDto {
  row: RowView;
}

export function toTransactionRecord(row: RowView): TransactionRecord {
  // Rows written under the older six-stage workflow still say Washing/Drying/
  // Folding; those all mean "still being worked on" today.
  const orderStatus = normaliseOrderStatus(row.get('Order Status') || 'Received');
  return {
    transactionId: row.get('Transaction ID'),
    orNumber: row.get('O.R. Number'),
    customerId: row.get('Customer ID'),
    customerName: row.get('Customer Name'),
    contactNumber: row.get('Contact Number'),
    serviceId: row.get('Service ID'),
    serviceType: row.get('Service Type'),
    quantity: row.num('Quantity'),
    unitPrice: row.num('Unit Price'),
    subtotal: row.num('Subtotal'),
    discount: row.num('Discount'),
    additionalCharge: row.num('Additional Charge'),
    totalPayment: row.num('Total Payment'),
    paidAmount: row.num('Paid Amount'),
    change: row.num('Change'),
    balance: row.num('Balance'),
    paymentStatus: (row.get('Payment Status') || 'Unpaid') as PaymentStatus,
    modeOfPayment: row.get('Mode of Payment') || '',
    orderStatus,
    transactionDate: row.get('Transaction Date'),
    datePaid: row.get('Date Paid') || null,
    pickupStatus: derivePickupStatus(orderStatus),
    datePickedUp: row.get('Date Picked Up') || null,
    pickedUpBy: row.get('Picked Up By'),
    expectedPickup: row.get('Expected Pickup') || null,
    timeStamp: row.get('Time Stamp'),
    createdBy: row.get('Created By'),
    updatedBy: row.get('Updated By'),
    status: row.get('Status') === 'Cancelled' ? 'Cancelled' : 'Active',
    notes: row.get('Notes'),
    row,
  };
}

export function toTransactionDto(record: TransactionRecord): TransactionDto {
  const { row: _row, ...dto } = record;
  return dto;
}

export async function transactionsTable(fresh = false): Promise<SheetTable> {
  return getStore().table(SHEETS.transactions, { fresh });
}

export async function findTransactionRecord(
  identifier: string,
): Promise<TransactionRecord | null> {
  const table = await transactionsTable();
  const row = table.find(
    (candidate) =>
      candidate.get('Transaction ID') === identifier ||
      candidate.get('O.R. Number') === identifier,
  );
  return row ? toTransactionRecord(row) : null;
}

/**
 * Idempotency lookup. Reads fresh by default, because a replay must never be
 * answered from a stale cache.
 *
 * Callers that have just refreshed the table themselves pass `fresh: false` —
 * re-reading it would be a second full round trip to learn nothing new.
 */
export async function findByIdempotencyKey(
  key: string,
  options: { fresh?: boolean } = {},
): Promise<TransactionRecord | null> {
  if (!key) return null;
  const table = await transactionsTable(options.fresh !== false);
  const row = table.find((candidate) => candidate.get('Idempotency Key') === key);
  return row ? toTransactionRecord(row) : null;
}

/** Recompute every derived money field from the stored inputs. */
export function recomputeMoneyFields(source: {
  unitPrice: number;
  quantity: number;
  discount: number;
  additionalCharge: number;
  paidAmount: number;
}) {
  return computeTransactionMoney({
    unitPrice: toCentavos(source.unitPrice),
    quantity: source.quantity,
    discount: toCentavos(source.discount),
    additionalCharge: toCentavos(source.additionalCharge),
    paidAmount: toCentavos(source.paidAmount),
  });
}

export type ComputedMoney = ReturnType<typeof recomputeMoneyFields>;

/** Map computed money onto the sheet's column names. */
export function moneyPatch(money: ComputedMoney): Record<string, string> {
  return {
    Subtotal: toPesos(money.subtotal).toFixed(2),
    Discount: toPesos(money.discount).toFixed(2),
    'Additional Charge': toPesos(money.additionalCharge).toFixed(2),
    'Total Payment': toPesos(money.total).toFixed(2),
    'Paid Amount': toPesos(money.paidAmount).toFixed(2),
    Change: toPesos(money.change).toFixed(2),
    Balance: toPesos(money.balance).toFixed(2),
  };
}

export function paymentStatusFor(money: ComputedMoney, cancelled: boolean, refunded = false) {
  return derivePaymentStatus(money, cancelled, refunded);
}

export const nowStamp = () => manilaIso();
export const todayKey = () => manilaDateKey();

/* ------------------------------------------------------------------ query */

export interface TransactionQuery {
  page: number;
  pageSize: number;
  search?: string;
  customerId?: string;
  serviceId?: string;
  paymentStatus?: string;
  orderStatus?: string;
  pickupStatus?: string;
  modeOfPayment?: string;
  from?: string;
  to?: string;
  /** Only orders that still owe money. */
  outstanding?: boolean;
  includeCancelled?: boolean;
  sortBy?: 'date' | 'total' | 'customer' | 'or';
  sortDir?: 'asc' | 'desc';
}

export function matchesQuery(item: TransactionDto, query: TransactionQuery): boolean {
  if (!query.includeCancelled && item.status === 'Cancelled') return false;
  if (query.customerId && item.customerId !== query.customerId) return false;
  if (query.serviceId && item.serviceId !== query.serviceId) return false;
  if (query.paymentStatus && item.paymentStatus !== query.paymentStatus) return false;
  if (query.orderStatus && item.orderStatus !== query.orderStatus) return false;
  if (query.pickupStatus && item.pickupStatus !== query.pickupStatus) return false;

  /*
   * "Owes money" is not a single status — it covers both Unpaid and Partially
   * Paid — so it cannot be expressed with the paymentStatus filter. It is what
   * the counter actually wants to see: orders still to be settled.
   */
  if (query.outstanding && !(item.balance > 0 && item.paymentStatus !== 'Refunded')) return false;

  /*
   * A split payment is stored as "Cash + GCash", so exact matching would hide
   * it from both the Cash and the GCash filter — the two places someone
   * reconciling the drawer would look for it.
   */
  if (query.modeOfPayment && !item.modeOfPayment.includes(query.modeOfPayment)) return false;
  if (query.from && item.transactionDate < query.from) return false;
  if (query.to && item.transactionDate > query.to) return false;

  const search = query.search?.trim().toLowerCase();
  if (search) {
    const digits = search.replace(/\D/g, '');
    const haystack = [
      item.transactionId,
      item.orNumber,
      item.customerName,
      item.customerId,
      item.serviceType,
    ]
      .join(' ')
      .toLowerCase();
    const contactMatch =
      digits.length >= 3 && item.contactNumber.replace(/\D/g, '').includes(digits);
    if (!haystack.includes(search) && !contactMatch) return false;
  }
  return true;
}

export async function listTransactions(
  query: TransactionQuery,
): Promise<Paginated<TransactionDto>> {
  const table = await transactionsTable();
  const items = table.rows
    .map(toTransactionRecord)
    .map(toTransactionDto)
    .filter((item) => matchesQuery(item, query));

  const dir = query.sortDir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    switch (query.sortBy) {
      case 'total':
        return (a.totalPayment - b.totalPayment) * dir;
      case 'customer':
        return a.customerName.localeCompare(b.customerName) * dir;
      case 'or':
        return a.orNumber.localeCompare(b.orNumber) * dir;
      case 'date':
      default:
        return (
          (a.timeStamp || a.transactionDate).localeCompare(b.timeStamp || b.transactionDate) * dir
        );
    }
  });

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

/** All non-cancelled transactions currently inside the laundry workflow. */
export async function listActiveTransactions(): Promise<TransactionDto[]> {
  const table = await transactionsTable();
  return table.rows
    .map(toTransactionRecord)
    .map(toTransactionDto)
    .filter((item) => item.status === 'Active');
}

/**
 * Resolve a transaction row from either identifier.
 *
 * Staff read O.R. numbers off the receipt, so every endpoint accepts either the
 * Transaction ID or the O.R. Number. Mutations use this so the identifier that
 * works for a lookup also works for an update.
 */
export function resolveRow(table: SheetTable, identifier: string): RowView | undefined {
  const needle = identifier.trim();
  if (!needle) return undefined;
  return table.find(
    (candidate) =>
      candidate.get('Transaction ID') === needle || candidate.get('O.R. Number') === needle,
  );
}

/**
 * Serialise all writes to one transaction under a CANONICAL lock name.
 *
 * Callers may address a transaction by either identifier, so the lock is keyed
 * on the resolved Transaction ID — otherwise two requests editing the same sale
 * (one by O.R. number, one by ID) would take different locks and could lose an
 * update.
 */
export async function withTransactionLock<T>(
  identifier: string,
  fn: () => Promise<T>,
): Promise<T> {
  const table = await transactionsTable();
  const row = resolveRow(table, identifier);
  const canonical = row ? row.get('Transaction ID') : identifier;
  return withNamedLock('transaction:' + canonical, fn);
}
