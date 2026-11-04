import { COUNTER_KEYS, SETTINGS_KEYS, SHEETS } from '../../shared/constants.js';
import { manilaCompactDate } from '../../shared/datetime.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { getStore } from '../sheets/index.js';
import type { SheetTable } from '../sheets/table.js';
import { formatSequence, prefixedId } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { getNumericSetting, getSetting } from './settings.service.js';

const MAX_ATTEMPTS = 10;

/**
 * O.R. and transaction number generation.
 *
 * Two independent guarantees:
 *   1. The counter increment is atomic at the storage layer (Apps Script
 *      LockService, or a process mutex for the REST driver).
 *   2. Every generated value is verified against the live Transactions sheet
 *      before it is handed out, so a manual edit in the workbook can never
 *      produce a duplicate. On collision we simply take the next number.
 */

/** Sequential ids for the simpler entities (customers, services, users, payments). */
export async function nextEntityId(
  counter: (typeof COUNTER_KEYS)[keyof typeof COUNTER_KEYS],
  prefix: string,
  sheet: string,
  column: string,
  width = 6,
): Promise<string> {
  return withNamedLock('sequence:' + counter, async () => {
    const store = getStore();
    const table = await store.table(sheet);

    let seed = 0;
    for (const row of table.rows) {
      const value = row.get(column);
      const parsed = Number(value.replace(/\D/g, ''));
      if (Number.isFinite(parsed) && parsed > seed) seed = parsed;
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const next = await store.bumpCounter(counter, seed, 1);
      const candidate = prefix + formatSequence(next, width);
      const fresh = await store.table(sheet, { fresh: true });
      if (!fresh.find((row) => row.get(column) === candidate)) return candidate;
    }
    throw new AppError('CONFLICT', 'Unable to allocate a unique identifier for ' + sheet + '.');
  });
}

/* ------------------------------------------------------- batched allocation */

export interface SaleIdentifierRequest {
  needCustomerId: boolean;
  /** How many ledger rows the sale needs — one per payment method used. */
  paymentCount: number;
}

export interface SaleIdentifiers {
  transactionId: string;
  customerId: string | null;
  paymentIds: string[];
}

/**
 * Suggest the next O.R. number, purely as a convenience for the cashier.
 *
 * The authoritative number is whatever is printed in the BIR booklet, so this
 * is only a starting point they can overwrite — it is never used unless they
 * accept it.
 */
export async function suggestNextOrNumber(): Promise<string> {
  const prefix = await getSetting(SETTINGS_KEYS.orPrefix, 'OR-');
  const padding = await getNumericSetting(SETTINGS_KEYS.orPadding, 6);
  const table = await getStore().table(SHEETS.transactions);

  let highest = 0;
  for (const row of table.rows) {
    const value = row.get('O.R. Number');
    if (!value) continue;
    const digits = value.replace(/\D/g, '');
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return prefix + formatSequence(highest + 1, padding);
}

/** Is this O.R. number already used by another transaction? */
export async function isOrNumberTaken(
  orNumber: string,
  excludeTransactionId?: string,
): Promise<boolean> {
  const table = await getStore().table(SHEETS.transactions);
  const needle = orNumber.trim().toUpperCase();
  return table.rows.some(
    (row) =>
      row.get('O.R. Number').trim().toUpperCase() === needle &&
      row.get('Transaction ID') !== excludeTransactionId,
  );
}

/** Highest numeric value already present in a column, for seeding a counter. */
function highestIn(table: SheetTable, column: string, prefix = ''): number {
  let highest = 0;
  for (const row of table.rows) {
    const value = row.get(column);
    if (!value) continue;
    const digits = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value.replace(/\D/g, '');
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return highest;
}

/**
 * Allocate every identifier a sale needs in ONE atomic round trip.
 *
 * Against a remote gateway each counter increment is a separate HTTPS call, so
 * doing these one at a time cost roughly ten seconds at the counter. Batched,
 * the whole group is one call taken under a single lock — the uniqueness
 * guarantee is unchanged, only the number of trips.
 *
 * Callers must have refreshed Transactions, Customers and Payments first; the
 * seeds and the collision check are taken from those tables.
 */
export async function allocateSaleIdentifiers(
  request: SaleIdentifierRequest,
): Promise<SaleIdentifiers> {
  const store = getStore();
  const [transactions, customers, payments] = await Promise.all([
    store.table(SHEETS.transactions),
    store.table(SHEETS.customers),
    store.table(SHEETS.payments),
  ]);

  const txnPrefix = await getSetting(SETTINGS_KEYS.txnPrefix, 'NF');
  const datePart = manilaCompactDate();
  const txnCounter = 'TXN_' + datePart;

  return withNamedLock('sequence:sale', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // No O.R. counter here: that number comes from the BIR booklet and is
      // typed by the cashier, so the system records it rather than issuing it.
      const requests = [{ name: txnCounter, delta: 1, seedIfMissing: 0 }];
      if (request.needCustomerId) {
        requests.push({
          name: COUNTER_KEYS.customerId,
          delta: 1,
          seedIfMissing: highestIn(customers, 'Customer ID'),
        });
      }
      // One increment per ledger row. A split payment needs several ids, and
      // taking them in the same locked call keeps them contiguous.
      if (request.paymentCount > 0) {
        requests.push({
          name: COUNTER_KEYS.paymentId,
          delta: request.paymentCount,
          seedIfMissing: highestIn(payments, 'Payment ID'),
        });
      }

      const values = await store.bumpCounters(requests);

      const transactionId =
        txnPrefix + '-' + datePart + '-' + formatSequence(values[txnCounter] ?? 0, 4);

      // Guard against a duplicate introduced by a manual edit to the workbook.
      // Guard against a duplicate transaction id introduced by a manual edit.
      const clash = transactions.find((row) => row.get('Transaction ID') === transactionId);
      if (clash) {
        logger.warn('Transaction id collision detected, advancing counter', { transactionId });
        continue;
      }

      // The counter returns the value AFTER adding paymentCount, so the ids
      // this sale owns are the n values ending there.
      const lastPaymentValue = values[COUNTER_KEYS.paymentId] ?? 0;
      const paymentIds = Array.from({ length: request.paymentCount }, (_, index) =>
        prefixedId('PAY-', lastPaymentValue - request.paymentCount + 1 + index, 6),
      );

      return {
        transactionId,
        customerId: request.needCustomerId
          ? prefixedId('CUST-', values[COUNTER_KEYS.customerId] ?? 0, 5)
          : null,
        paymentIds,
      };
    }

    throw new AppError(
      'CONFLICT',
      'Unable to allocate a unique O.R. number. Please check the Transactions sheet for duplicates.',
    );
  });
}
