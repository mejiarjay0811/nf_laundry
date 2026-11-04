import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHEETS } from '../../shared/constants.js';
import { LocalSheetsGateway } from '../sheets/drivers/local.js';
import { SheetStore } from '../sheets/store.js';
import { SHEET_DEFINITIONS } from '../sheets/schema.js';
import { setStoreForTesting } from '../sheets/index.js';
import { buildSalesSummary } from '../services/report.service.js';

/**
 * Reporting arithmetic against a real store.
 *
 * These figures are what the shop owner reads to decide whether the day went
 * well, so they are worth pinning down with fixtures rather than trusting the
 * aggregation by inspection.
 */
let dataDir: string;

const DAY = '2026-09-03';

/** Minimal transaction row; anything omitted takes a sensible default. */
function txn(fields: Record<string, string>): Record<string, string> {
  return {
    'Transaction ID': 'NF-1',
    'O.R. Number': 'OR-000001',
    'Customer ID': 'CUST-00001',
    'Customer Name': 'Test Customer',
    'Contact Number': '09170000000',
    'Service ID': 'SVC-001',
    'Service Type': 'Wash/Dry',
    Quantity: '1',
    'Unit Price': '175.00',
    Subtotal: '175.00',
    Discount: '0.00',
    'Additional Charge': '0.00',
    'Total Payment': '175.00',
    'Paid Amount': '175.00',
    Change: '0.00',
    Balance: '0.00',
    'Payment Status': 'Paid',
    'Mode of Payment': 'Cash',
    'Order Status': 'Picked Up',
    'Transaction Date': DAY,
    'Date Paid': DAY + 'T10:00:00+08:00',
    'Pickup Status': 'Picked Up',
    'Date Picked Up': '',
    'Picked Up By': '',
    'Expected Pickup': DAY,
    'Time Stamp': DAY + 'T10:00:00+08:00',
    'Created By': 'admin',
    'Updated By': 'admin',
    Status: 'Active',
    Notes: '',
    'Idempotency Key': '',
    ...fields,
  };
}

function payment(fields: Record<string, string>): Record<string, string> {
  return {
    'Payment ID': 'PAY-000001',
    'Transaction ID': 'NF-1',
    'O.R. Number': 'OR-000001',
    'Customer ID': 'CUST-00001',
    Amount: '175.00',
    'Mode of Payment': 'Cash',
    'Payment Date': DAY + 'T10:00:00+08:00',
    'Received By': 'admin',
    'Reference Number': '',
    Notes: '',
    Status: 'Active',
    'Idempotency Key': '',
    ...fields,
  };
}

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-reporting-'));
  const gateway = new LocalSheetsGateway(dataDir);
  await gateway.connect();
  await gateway.ensureSheets(SHEET_DEFINITIONS);

  const store = new SheetStore(gateway, 0);
  setStoreForTesting(store);

  await store.appendRecords(SHEETS.transactions, [
    // Settled with a larger note: 350 owed, 500 tendered, 150 back as change.
    txn({
      'Transaction ID': 'NF-OVERPAID',
      'O.R. Number': 'OR-000001',
      Quantity: '2',
      Subtotal: '350.00',
      'Total Payment': '350.00',
      'Paid Amount': '500.00',
      Change: '150.00',
      Balance: '0.00',
    }),
    // Half paid: 200 owed, 120 taken, 80 still owing.
    txn({
      'Transaction ID': 'NF-PARTIAL',
      'O.R. Number': 'OR-000002',
      'Service Type': 'Wash Only',
      Quantity: '2',
      'Unit Price': '100.00',
      Subtotal: '200.00',
      'Total Payment': '200.00',
      'Paid Amount': '120.00',
      Change: '0.00',
      Balance: '80.00',
      'Payment Status': 'Partially Paid',
      'Mode of Payment': 'GCash',
    }),
    // Cancelled - must not appear in any figure.
    txn({
      'Transaction ID': 'NF-CANCELLED',
      'O.R. Number': 'OR-000003',
      'Total Payment': '999.00',
      'Paid Amount': '999.00',
      'Payment Status': 'Cancelled',
      Status: 'Cancelled',
      'Order Status': 'Cancelled',
    }),
  ]);

  await store.appendRecords(SHEETS.payments, [
    payment({ 'Payment ID': 'PAY-000001', 'Transaction ID': 'NF-OVERPAID', Amount: '350.00' }),
    payment({
      'Payment ID': 'PAY-000002',
      'Transaction ID': 'NF-PARTIAL',
      Amount: '120.00',
      'Mode of Payment': 'GCash',
    }),
    payment({ 'Payment ID': 'PAY-000003', 'Transaction ID': 'NF-CANCELLED', Amount: '999.00' }),
  ]);
});

afterAll(async () => {
  setStoreForTesting(null);
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('sales summary', () => {
  it('counts sales on the bill total, not on what was tendered', async () => {
    const summary = await buildSalesSummary(DAY, DAY, 'Test');
    expect(summary.totalSales).toBe(550); // 350 + 200
    expect(summary.totalTransactions).toBe(2);
  });

  it('reports collected money net of change handed back', async () => {
    const summary = await buildSalesSummary(DAY, DAY, 'Test');
    // 350 applied on the overpaid sale (NOT the 500 tendered) + 120 partial.
    expect(summary.collectedAmount).toBe(470);
  });

  it('keeps collected in step with the cash and GCash breakdown', async () => {
    const summary = await buildSalesSummary(DAY, DAY, 'Test');
    // The ledger view and the transaction view must agree, or the day's
    // takings appear to come from nowhere.
    expect(summary.cashSales + summary.gcashSales).toBe(summary.collectedAmount);
    expect(summary.cashSales).toBe(350);
    expect(summary.gcashSales).toBe(120);
  });

  it('carries the unpaid remainder as outstanding', async () => {
    const summary = await buildSalesSummary(DAY, DAY, 'Test');
    expect(summary.outstandingBalance).toBe(80);
    expect(summary.totalSales).toBe(summary.collectedAmount + summary.outstandingBalance);
  });

  it('excludes cancelled transactions and their payments entirely', async () => {
    const summary = await buildSalesSummary(DAY, DAY, 'Test');
    expect(summary.totalSales).not.toBe(1549);
    expect(summary.cashSales).not.toBe(1349);
    expect(summary.byService.some((s) => s.sales === 999)).toBe(false);
  });

  it('averages over counted transactions only', async () => {
    const summary = await buildSalesSummary(DAY, DAY, 'Test');
    expect(summary.averageTransactionValue).toBe(275); // 550 / 2
  });
});
