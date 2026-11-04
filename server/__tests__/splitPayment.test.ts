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
import { createTransaction } from '../services/sale.service.js';
import { recordPayment } from '../services/payment.service.js';
import { buildSalesSummary } from '../services/report.service.js';

/**
 * A bill settled with more than one method.
 *
 * The rules worth pinning down: each method becomes its own ledger row (that is
 * what cash/GCash reporting reads), only money that settles the bill counts as
 * revenue, and change always comes out of cash because GCash cannot give any.
 */
const ACTOR: SessionUser = {
  userId: 'USR-0001',
  username: 'admin',
  fullName: 'System Administrator',
  role: 'Admin',
};

let dataDir: string;
let store: SheetStore;
let keyCounter = 0;

const nextKey = () => 'split-test-' + (keyCounter += 1) + '-padding';

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-split-'));
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

async function sell(payments: Array<{ modeOfPayment: 'Cash' | 'GCash'; amount: number }>) {
  return createTransaction(
    {
      newCustomer: { fullName: 'Split Payer ' + keyCounter },
      orNumber: 'OR-TEST-' + keyCounter,
      serviceId: 'SVC-001',
      quantity: 1,
      payments,
      idempotencyKey: nextKey(),
    },
    ACTOR,
    {},
  );
}

describe('split payment', () => {
  it('settles a bill from two methods and labels it as both', async () => {
    // The worked example: ₱175 due, ₱100 cash + ₱75 GCash.
    const result = await sell([
      { modeOfPayment: 'Cash', amount: 100 },
      { modeOfPayment: 'GCash', amount: 75 },
    ]);

    expect(result.transaction.totalPayment).toBe(175);
    expect(result.transaction.paidAmount).toBe(175);
    expect(result.transaction.balance).toBe(0);
    expect(result.transaction.change).toBe(0);
    expect(result.transaction.paymentStatus).toBe('Paid');
    expect(result.transaction.modeOfPayment).toBe('Cash + GCash');

    // One ledger row per method, each carrying its own share.
    expect(result.payments).toHaveLength(2);
    const byMode = Object.fromEntries(
      result.payments.map((p) => [p.modeOfPayment, p.amount]),
    );
    expect(byMode.Cash).toBe(100);
    expect(byMode.GCash).toBe(75);
    // Payment ids are distinct even though they were allocated together.
    expect(new Set(result.payments.map((p) => p.paymentId)).size).toBe(2);
  });

  it('takes change out of cash, never out of GCash', async () => {
    // ₱175 due, ₱100 cash + ₱100 GCash = ₱200 tendered, ₱25 change.
    const result = await sell([
      { modeOfPayment: 'Cash', amount: 100 },
      { modeOfPayment: 'GCash', amount: 100 },
    ]);

    expect(result.transaction.totalPayment).toBe(175);
    expect(result.change).toBe(25);
    expect(result.transaction.balance).toBe(0);

    const byMode = Object.fromEntries(
      result.payments.map((p) => [p.modeOfPayment, p.amount]),
    );
    // GCash is applied in full; the cash absorbs the overshoot.
    expect(byMode.GCash).toBe(100);
    expect(byMode.Cash).toBe(75);
    // Only money that settled the bill was recorded as revenue.
    expect(byMode.Cash + byMode.GCash).toBe(175);
  });

  it('refuses an overpayment that has no cash to give change from', async () => {
    await expect(sell([{ modeOfPayment: 'GCash', amount: 200 }])).rejects.toThrow(
      /no cash to give change from/i,
    );
  });

  it('leaves a balance when the split does not cover the bill', async () => {
    const result = await sell([
      { modeOfPayment: 'Cash', amount: 50 },
      { modeOfPayment: 'GCash', amount: 25 },
    ]);

    expect(result.transaction.paidAmount).toBe(75);
    expect(result.transaction.balance).toBe(100);
    expect(result.transaction.paymentStatus).toBe('Partially Paid');
    expect(result.payments).toHaveLength(2);
  });

  it('collapses repeats of the same method into one ledger row', async () => {
    const result = await sell([
      { modeOfPayment: 'Cash', amount: 100 },
      { modeOfPayment: 'Cash', amount: 75 },
    ]);

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]?.amount).toBe(175);
    expect(result.transaction.modeOfPayment).toBe('Cash');
  });

  it('records an unpaid order when nothing is tendered', async () => {
    const result = await sell([]);

    expect(result.transaction.paidAmount).toBe(0);
    expect(result.transaction.balance).toBe(175);
    expect(result.transaction.paymentStatus).toBe('Unpaid');
    expect(result.transaction.modeOfPayment).toBe('');
    expect(result.payments).toHaveLength(0);
  });

  it('reports each method separately in the sales summary', async () => {
    const summary = await buildSalesSummary(
      result_dateKey(),
      result_dateKey(),
      'Split payment test',
    );

    // Every sale above was ₱175; cash and GCash must add up to what was
    // collected, with nothing invented and nothing lost.
    expect(summary.cashSales + summary.gcashSales).toBe(summary.collectedAmount);
    expect(summary.cashSales).toBeGreaterThan(0);
    expect(summary.gcashSales).toBeGreaterThan(0);
  });
});

function result_dateKey(): string {
  // Sales are attributed to the Manila date the sale was written on.
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

describe('manual O.R. number', () => {
  it('records the number the cashier typed, not a generated one', async () => {
    const result = await createTransaction(
      {
        newCustomer: { fullName: 'Booklet Customer' },
        orNumber: '0004521',
        serviceId: 'SVC-001',
        quantity: 1,
        payments: [{ modeOfPayment: 'Cash', amount: 175 }],
        idempotencyKey: 'or-manual-1-padding',
      },
      ACTOR,
      {},
    );
    expect(result.transaction.orNumber).toBe('0004521');
    // Every ledger row carries the same receipt number.
    expect(result.payments[0]?.orNumber).toBe('0004521');
  });

  it('refuses a number already used, naming who used it', async () => {
    await expect(
      createTransaction(
        {
          newCustomer: { fullName: 'Second Customer' },
          orNumber: '0004521',
          serviceId: 'SVC-001',
          quantity: 1,
          payments: [],
          idempotencyKey: 'or-manual-2-padding',
        },
        ACTOR,
        {},
      ),
    ).rejects.toThrow(/already used/i);
  });

  it('treats the same number in different case as a duplicate', async () => {
    await createTransaction(
      {
        newCustomer: { fullName: 'Mixed Case One' },
        orNumber: 'ab-77',
        serviceId: 'SVC-001',
        quantity: 1,
        payments: [],
        idempotencyKey: 'or-case-1-padding',
      },
      ACTOR,
      {},
    );

    await expect(
      createTransaction(
        {
          newCustomer: { fullName: 'Mixed Case Two' },
          orNumber: 'AB-77',
          serviceId: 'SVC-001',
          quantity: 1,
          payments: [],
          idempotencyKey: 'or-case-2-padding',
        },
        ACTOR,
        {},
      ),
    ).rejects.toThrow(/already used/i);
  });

  it('requires a number', async () => {
    await expect(
      createTransaction(
        {
          newCustomer: { fullName: 'No Receipt' },
          orNumber: '   ',
          serviceId: 'SVC-001',
          quantity: 1,
          payments: [],
          idempotencyKey: 'or-blank-1-padding',
        },
        ACTOR,
        {},
      ),
    ).rejects.toThrow(/O.R. number/i);
  });
});
