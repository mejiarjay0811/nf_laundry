import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHEETS } from '../../shared/constants.js';
import type { SessionUser } from '../../shared/types.js';
import { LocalSheetsGateway } from '../sheets/drivers/local.js';
import { SHEET_DEFINITIONS } from '../sheets/schema.js';
import { setStoreForTesting } from '../sheets/index.js';
import { SheetStore } from '../sheets/store.js';
import { recordPayment } from '../services/payment.service.js';
import { createTransaction } from '../services/sale.service.js';

/**
 * Settling a balance after the sale, rather than at the till.
 *
 * The same rules have to hold here as when ringing up: one ledger row per
 * method, change only ever out of cash, and the transaction's recorded method
 * describing everything paid against it — not just the latest instalment.
 */
const ACTOR: SessionUser = {
  userId: 'USR-0001',
  username: 'admin',
  fullName: 'System Administrator',
  role: 'Admin',
};

let dataDir: string;
let store: SheetStore;
let counter = 0;

const nextKey = () => 'settle-test-' + (counter += 1) + '-padding';

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-settle-'));
  const gateway = new LocalSheetsGateway(dataDir);
  await gateway.connect();
  await gateway.ensureSheets(SHEET_DEFINITIONS);

  store = new SheetStore(gateway, 0);
  setStoreForTesting(store);

  await store.appendRecords(SHEETS.services, [
    {
      'Service ID': 'SVC-001',
      Name: 'Wash/Dry',
      Description: '',
      Price: '175.00',
      Unit: 'load',
      Status: 'Active',
      'Sort Order': '1',
      'Created At': '',
      'Updated At': '',
    },
  ]);
});

afterAll(async () => {
  setStoreForTesting(null);
  await fs.rm(dataDir, { recursive: true, force: true });
});

/** A sale, optionally part-paid, leaving a balance to settle later. */
async function sell(payments: Array<{ modeOfPayment: 'Cash' | 'GCash'; amount: number }> = []) {
  counter += 1;
  return createTransaction(
    {
      newCustomer: { fullName: 'Settler ' + counter },
      orNumber: 'OR-SETTLE-' + counter,
      serviceId: 'SVC-001',
      quantity: 1,
      payments,
      idempotencyKey: nextKey(),
    },
    ACTOR,
    {},
  );
}

describe('settling an outstanding balance', () => {
  it('accepts half cash and half GCash against a balance', async () => {
    const sale = await sell();
    expect(sale.transaction.balance).toBe(175);

    const result = await recordPayment(
      sale.transaction.transactionId,
      {
        payments: [
          { modeOfPayment: 'Cash', amount: 100 },
          { modeOfPayment: 'GCash', amount: 75 },
        ],
        idempotencyKey: nextKey(),
      },
      ACTOR,
    );

    expect(result.transaction.paidAmount).toBe(175);
    expect(result.transaction.balance).toBe(0);
    expect(result.transaction.paymentStatus).toBe('Paid');
    expect(result.change).toBe(0);

    // One row per method, because the cash and GCash totals are summed from
    // the ledger.
    expect(result.payments).toHaveLength(2);
    const byMode = Object.fromEntries(result.payments.map((p) => [p.modeOfPayment, p.amount]));
    expect(byMode.Cash).toBe(100);
    expect(byMode.GCash).toBe(75);
    expect(result.transaction.modeOfPayment).toBe('Cash + GCash');
  });

  it('keeps the earlier method when a later instalment uses another', async () => {
    // Half in cash at the till, the rest by GCash on collection. Overwriting
    // the method would erase the cash that was taken.
    const sale = await sell([{ modeOfPayment: 'Cash', amount: 75 }]);
    expect(sale.transaction.modeOfPayment).toBe('Cash');
    expect(sale.transaction.balance).toBe(100);

    const result = await recordPayment(
      sale.transaction.transactionId,
      { payments: [{ modeOfPayment: 'GCash', amount: 100 }], idempotencyKey: nextKey() },
      ACTOR,
    );

    expect(result.transaction.balance).toBe(0);
    expect(result.transaction.modeOfPayment).toBe('Cash + GCash');
  });

  it('refuses an overpayment with no cash to give change from', async () => {
    const sale = await sell();

    await expect(
      recordPayment(
        sale.transaction.transactionId,
        { payments: [{ modeOfPayment: 'GCash', amount: 200 }], idempotencyKey: nextKey() },
        ACTOR,
      ),
    ).rejects.toThrow(/change/i);
  });

  it('takes change from the cash and records only what settled the bill', async () => {
    const sale = await sell();

    const result = await recordPayment(
      sale.transaction.transactionId,
      {
        payments: [
          { modeOfPayment: 'GCash', amount: 100 },
          { modeOfPayment: 'Cash', amount: 200 },
        ],
        idempotencyKey: nextKey(),
      },
      ACTOR,
    );

    // 300 tendered against 175: GCash covers 100, cash covers the last 75,
    // and 125 goes back from the drawer.
    expect(result.change).toBe(125);
    expect(result.transaction.paidAmount).toBe(175);
    expect(result.transaction.balance).toBe(0);

    const byMode = Object.fromEntries(result.payments.map((p) => [p.modeOfPayment, p.amount]));
    expect(byMode.GCash).toBe(100);
    expect(byMode.Cash).toBe(75);
  });

  it('replays a repeated settlement instead of taking the money twice', async () => {
    const sale = await sell();
    const key = nextKey();

    const first = await recordPayment(
      sale.transaction.transactionId,
      { payments: [{ modeOfPayment: 'Cash', amount: 175 }], idempotencyKey: key },
      ACTOR,
    );
    const second = await recordPayment(
      sale.transaction.transactionId,
      { payments: [{ modeOfPayment: 'Cash', amount: 175 }], idempotencyKey: key },
      ACTOR,
    );

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.transaction.paidAmount).toBe(175);
  });

  it('still accepts the single-amount form', async () => {
    const sale = await sell();

    const result = await recordPayment(
      sale.transaction.transactionId,
      { amount: 175, modeOfPayment: 'Cash', idempotencyKey: nextKey() },
      ACTOR,
    );

    expect(result.transaction.balance).toBe(0);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]?.modeOfPayment).toBe('Cash');
  });
});
