import { countsTowardSales } from '../../shared/calc.js';
import { PAYMENT_MODES, SHEETS } from '../../shared/constants.js';
import { enumerateDateKeys } from '../../shared/datetime.js';
import { toCentavos, toPesos, type Centavos } from '../../shared/money.js';
import type { SalesSummary, TransactionDto } from '../../shared/types.js';
import { getStore } from '../sheets/index.js';
import { toPaymentDto } from './payment.service.js';
import { toTransactionDto, toTransactionRecord, transactionsTable } from './transaction.service.js';

/**
 * Every figure in every report is derived here, directly from the Transactions
 * and Payments sheets. No running totals are stored anywhere, so a report can
 * never drift out of agreement with the underlying records.
 *
 * Two different notions of money are reported, and they are not the same:
 *   SALES          - accrual, attributed to the transaction date.
 *   CASH / GCASH   - collections, attributed to the date the money arrived,
 *                    which is what makes partial payments add up correctly.
 */

export interface PeriodData {
  transactions: TransactionDto[];
  counted: TransactionDto[];
  collections: Array<{ dateKey: string; mode: string; amountC: Centavos }>;
}

export async function loadPeriod(from: string, to: string): Promise<PeriodData> {
  const store = getStore();
  const [txnTable, paymentTable] = await Promise.all([
    transactionsTable(),
    store.table(SHEETS.payments),
  ]);

  const all = txnTable.rows.map(toTransactionRecord).map(toTransactionDto);

  const transactions = all.filter(
    (item) => item.transactionDate >= from && item.transactionDate <= to,
  );
  const counted = transactions.filter((item) =>
    countsTowardSales(item.status, item.paymentStatus),
  );

  // A payment only counts if its transaction is still valid.
  const invalidTransactionIds = new Set(
    all
      .filter((item) => !countsTowardSales(item.status, item.paymentStatus))
      .map((item) => item.transactionId),
  );

  const collections = paymentTable.rows
    .map(toPaymentDto)
    .filter((payment) => {
      if (payment.status !== 'Active') return false;
      if (invalidTransactionIds.has(payment.transactionId)) return false;
      const dateKey = payment.paymentDate.slice(0, 10);
      return dateKey >= from && dateKey <= to;
    })
    .map((payment) => ({
      dateKey: payment.paymentDate.slice(0, 10),
      mode: payment.modeOfPayment as string,
      amountC: toCentavos(payment.amount),
    }));

  return { transactions, counted, collections };
}

const sumC = (items: TransactionDto[], pick: (item: TransactionDto) => number): Centavos =>
  items.reduce((total, item) => total + toCentavos(pick(item)), 0);

export async function buildSalesSummary(
  from: string,
  to: string,
  label: string,
): Promise<SalesSummary> {
  const { counted, collections } = await loadPeriod(from, to);

  const totalSalesC = sumC(counted, (t) => t.totalPayment);
  // What the shop actually KEPT, not what was handed across the counter.
  // "Paid Amount" is the cash tendered, so on a 350 bill settled with a 500
  // note it reads 500 - but 150 of that went straight back as change. The
  // amount applied to the bill is total minus whatever is still owed, which
  // also stays correct for partial payments.
  const collectedC = sumC(counted, (t) => t.totalPayment - t.balance);
  const outstandingC = sumC(counted, (t) => t.balance);
  const discountsC = sumC(counted, (t) => t.discount);
  const surchargesC = sumC(counted, (t) => t.additionalCharge);

  const byMode = new Map<string, { count: number; amountC: Centavos }>();
  for (const mode of PAYMENT_MODES) byMode.set(mode, { count: 0, amountC: 0 });
  for (const entry of collections) {
    const bucket = byMode.get(entry.mode) ?? { count: 0, amountC: 0 };
    bucket.count += 1;
    bucket.amountC += entry.amountC;
    byMode.set(entry.mode, bucket);
  }

  const services = new Map<string, { transactions: number; quantity: number; salesC: Centavos }>();
  for (const item of counted) {
    const bucket = services.get(item.serviceType) ?? { transactions: 0, quantity: 0, salesC: 0 };
    bucket.transactions += 1;
    bucket.quantity += item.quantity;
    bucket.salesC += toCentavos(item.totalPayment);
    services.set(item.serviceType, bucket);
  }

  const paymentStatuses = new Map<string, { count: number; amountC: Centavos }>();
  for (const item of counted) {
    const bucket = paymentStatuses.get(item.paymentStatus) ?? { count: 0, amountC: 0 };
    bucket.count += 1;
    bucket.amountC += toCentavos(item.totalPayment);
    paymentStatuses.set(item.paymentStatus, bucket);
  }

  const pickupStatuses = new Map<string, number>();
  for (const item of counted) {
    pickupStatuses.set(item.pickupStatus, (pickupStatuses.get(item.pickupStatus) ?? 0) + 1);
  }

  const customers = new Map<
    string,
    { customerId: string; customerName: string; transactions: number; spendingC: Centavos }
  >();
  for (const item of counted) {
    const bucket = customers.get(item.customerId) ?? {
      customerId: item.customerId,
      customerName: item.customerName,
      transactions: 0,
      spendingC: 0,
    };
    bucket.transactions += 1;
    bucket.spendingC += toCentavos(item.totalPayment);
    customers.set(item.customerId, bucket);
  }

  const daily = new Map<
    string,
    { salesC: Centavos; transactions: number; cashC: Centavos; gcashC: Centavos }
  >();
  for (const dateKey of enumerateDateKeys(from, to)) {
    daily.set(dateKey, { salesC: 0, transactions: 0, cashC: 0, gcashC: 0 });
  }
  for (const item of counted) {
    const bucket = daily.get(item.transactionDate);
    if (!bucket) continue;
    bucket.salesC += toCentavos(item.totalPayment);
    bucket.transactions += 1;
  }
  for (const entry of collections) {
    const bucket = daily.get(entry.dateKey);
    if (!bucket) continue;
    if (entry.mode === 'GCash') bucket.gcashC += entry.amountC;
    else bucket.cashC += entry.amountC;
  }

  const averageC = counted.length > 0 ? Math.round(totalSalesC / counted.length) : 0;

  return {
    range: { from, to, label },
    totalSales: toPesos(totalSalesC),
    totalTransactions: counted.length,
    cashSales: toPesos(byMode.get('Cash')?.amountC ?? 0),
    gcashSales: toPesos(byMode.get('GCash')?.amountC ?? 0),
    collectedAmount: toPesos(collectedC),
    outstandingBalance: toPesos(outstandingC),
    discounts: toPesos(discountsC),
    additionalCharges: toPesos(surchargesC),
    averageTransactionValue: toPesos(averageC),
    customers: new Set(counted.map((item) => item.customerId)).size,
    byService: [...services.entries()]
      .map(([serviceType, value]) => ({
        serviceType,
        transactions: value.transactions,
        quantity: value.quantity,
        sales: toPesos(value.salesC),
      }))
      .sort((a, b) => b.sales - a.sales),
    byPaymentStatus: [...paymentStatuses.entries()].map(([status, value]) => ({
      status,
      count: value.count,
      amount: toPesos(value.amountC),
    })),
    byPickupStatus: [...pickupStatuses.entries()].map(([status, count]) => ({ status, count })),
    byPaymentMode: [...byMode.entries()].map(([mode, value]) => ({
      mode,
      count: value.count,
      amount: toPesos(value.amountC),
    })),
    topCustomers: [...customers.values()]
      .map((value) => ({
        customerId: value.customerId,
        customerName: value.customerName,
        transactions: value.transactions,
        spending: toPesos(value.spendingC),
      }))
      .sort((a, b) => b.spending - a.spending)
      .slice(0, 10),
    daily: [...daily.entries()].map(([dateKey, value]) => ({
      dateKey,
      sales: toPesos(value.salesC),
      transactions: value.transactions,
      cash: toPesos(value.cashC),
      gcash: toPesos(value.gcashC),
    })),
  };
}

/* ---------------------------------------------------------- period wrappers */

export async function getDailySummary(dateKey: string) {
  const summary = await buildSalesSummary(dateKey, dateKey, 'Daily Summary');
  const { counted } = await loadPeriod(dateKey, dateKey);
  const table = await transactionsTable();
  const all = table.rows.map(toTransactionRecord).map(toTransactionDto);

  const serviceCounts: Record<string, number> = {};
  for (const item of counted) {
    serviceCounts[item.serviceType] = (serviceCounts[item.serviceType] ?? 0) + 1;
  }

  return {
    ...summary,
    dateKey,
    readyForPickup: all.filter(
      (item) => item.status === 'Active' && item.orderStatus === 'Ready for Pickup',
    ).length,
    pickedUp: all.filter(
      (item) => item.status === 'Active' && (item.datePickedUp ?? '').slice(0, 10) === dateKey,
    ).length,
    serviceCounts,
  };
}

export async function getWeeklySummary(weekStart: string, weekEnd: string) {
  const summary = await buildSalesSummary(weekStart, weekEnd, 'Weekly Summary');
  const days = summary.daily.length || 1;
  const best = summary.daily.reduce<{ dateKey: string; sales: number } | null>(
    (top, day) => (top === null || day.sales > top.sales ? { dateKey: day.dateKey, sales: day.sales } : top),
    null,
  );
  return {
    ...summary,
    weekStart,
    weekEnd,
    averageDailySales: Math.round((summary.totalSales / days) * 100) / 100,
    bestDay: best && best.sales > 0 ? best : null,
  };
}

export async function getMonthlySummary(from: string, to: string, year: number, month: number) {
  const summary = await buildSalesSummary(from, to, 'Monthly Summary');
  const days = summary.daily.length || 1;
  const best = summary.daily.reduce<{ dateKey: string; sales: number } | null>(
    (top, day) => (top === null || day.sales > top.sales ? { dateKey: day.dateKey, sales: day.sales } : top),
    null,
  );
  return {
    ...summary,
    year,
    month,
    averageDailySales: Math.round((summary.totalSales / days) * 100) / 100,
    bestDay: best && best.sales > 0 ? best : null,
  };
}

export async function getYearlySummary(year: number) {
  const from = year + '-01-01';
  const to = year + '-12-31';
  const summary = await buildSalesSummary(from, to, String(year));

  const monthly = MONTH_LABELS.map((label, index) => ({
    month: index + 1,
    label,
    sales: 0,
    transactions: 0,
  }));

  for (const day of summary.daily) {
    const monthIndex = Number(day.dateKey.slice(5, 7)) - 1;
    const bucket = monthly[monthIndex];
    if (!bucket) continue;
    bucket.sales = Math.round((bucket.sales + day.sales) * 100) / 100;
    bucket.transactions += day.transactions;
  }

  const withSales = monthly.filter((m) => m.transactions > 0);
  const best = withSales.reduce<(typeof monthly)[number] | null>(
    (top, m) => (top === null || m.sales > top.sales ? m : top),
    null,
  );
  const lowest = withSales.reduce<(typeof monthly)[number] | null>(
    (bottom, m) => (bottom === null || m.sales < bottom.sales ? m : bottom),
    null,
  );

  return {
    ...summary,
    year,
    monthly,
    bestMonth: best ? { month: best.month, label: best.label, sales: best.sales } : null,
    lowestMonth: lowest ? { month: lowest.month, label: lowest.label, sales: lowest.sales } : null,
    averageMonthlySales:
      withSales.length > 0
        ? Math.round((summary.totalSales / withSales.length) * 100) / 100
        : 0,
  };
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
