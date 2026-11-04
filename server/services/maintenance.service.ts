import { COUNTER_KEYS, SHEETS } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import type { SessionUser } from '../../shared/types.js';
import { badRequest } from '../errors.js';
import { logger } from '../logger.js';
import { getStore } from '../sheets/index.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';

/**
 * Clearing the trading history so a shop can open its books fresh.
 *
 * This is the one operation in the system that destroys records rather than
 * marking them cancelled, so it is fenced accordingly: the caller must send
 * back an exact phrase, the audit row is written BEFORE anything is deleted,
 * and the scope is narrow and stated.
 *
 * What goes: transactions and the payments against them, and the counters that
 * number them, so the next sale starts at one again.
 *
 * What stays, deliberately:
 *   customers   the list is the shop's own work, and losing it would mean
 *               re-registering everyone who walks in
 *   services    the price list
 *   inventory   what is physically on the shelf does not change because the
 *               books were cleared
 *   expenses    money that actually left the business
 *   loyalty     points are a promise already made to a customer; wiping them
 *               silently would be taking something back
 *   users       and settings, which are not trading records at all
 *
 * The customer rollups ARE reset, because a "total spent" that counts orders
 * no longer on the sheet is a number nobody can check.
 */

export const RESET_PHRASE = 'DELETE ALL TRANSACTIONS';

export interface ResetSummary {
  transactionsRemoved: number;
  paymentsRemoved: number;
  customersReset: number;
  countersReset: string[];
}

export async function resetTransactionData(
  confirmation: string,
  actor: SessionUser,
): Promise<ResetSummary> {
  if (confirmation !== RESET_PHRASE) {
    throw badRequest('Type "' + RESET_PHRASE + '" exactly to confirm.');
  }

  return withNamedLock('maintenance:reset', async () => {
    const store = getStore();

    /*
     * Count first, and write the audit row before deleting anything. If the
     * clear fails halfway there is still a record saying who asked for it and
     * when — the opposite order would lose that for exactly the run where it
     * matters most.
     */
    const [transactions, payments] = await Promise.all([
      store.table(SHEETS.transactions, { fresh: true }),
      store.table(SHEETS.payments, { fresh: true }),
    ]);

    const transactionsRemoved = transactions.size;
    const paymentsRemoved = payments.size;

    await recordAudit({
      actor,
      action: 'DATA_RESET',
      module: 'System',
      entityId: 'transactions',
      previousValue: { transactions: transactionsRemoved, payments: paymentsRemoved },
      newValue: { confirmedBy: actor.username, at: manilaIso() },
    });

    logger.warn('Transaction data reset requested', {
      by: actor.username,
      transactions: transactionsRemoved,
      payments: paymentsRemoved,
    });

    await store.gateway.clearSheetData(SHEETS.transactions, 'DELETE_ALL_ROWS');
    await store.gateway.clearSheetData(SHEETS.payments, 'DELETE_ALL_ROWS');

    /* ---------------------------------------- put the counters back to zero */

    const countersReset: string[] = [];
    const counterTable = await store.table(SHEETS.counters, { fresh: true });
    for (const name of [COUNTER_KEYS.orNumber, COUNTER_KEYS.paymentId]) {
      const row = counterTable.rows.find((entry) => entry.get('Name') === name);
      if (!row) continue;
      await store.updateRecord(SHEETS.counters, row, {
        Value: '0',
        'Updated At': manilaIso(),
      });
      countersReset.push(name);
    }

    /* -------------------------------------------- zero the customer rollups */

    const customers = await store.table(SHEETS.customers, { fresh: true });
    const stale = customers.rows.filter(
      (row) => row.num('Total Transactions') > 0 || row.num('Total Spending') > 0,
    );

    for (const row of stale) {
      await store.updateRecord(SHEETS.customers, row, {
        'Total Transactions': '0',
        'Total Spending': '0.00',
        'Last Transaction Date': '',
        'Updated At': manilaIso(),
      });
    }

    store.invalidateAll();

    return {
      transactionsRemoved,
      paymentsRemoved,
      customersReset: stale.length,
      countersReset,
    };
  });
}

/** What a reset would remove, so the dialog can say it before it happens. */
export async function previewReset(): Promise<{
  transactions: number;
  payments: number;
  customers: number;
}> {
  const store = getStore();
  const [transactions, payments, customers] = await Promise.all([
    store.table(SHEETS.transactions),
    store.table(SHEETS.payments),
    store.table(SHEETS.customers),
  ]);

  return {
    transactions: transactions.size,
    payments: payments.size,
    customers: customers.rows.filter((row) => row.num('Total Transactions') > 0).length,
  };
}
