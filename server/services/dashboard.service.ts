import { SETTINGS_KEYS, SHEETS } from '../../shared/constants.js';
import { daysBetweenKeys, manilaDateKey, previousRange } from '../../shared/datetime.js';
import { percentChange } from '../../shared/money.js';
import type { AlertItem, DashboardMetrics } from '../../shared/types.js';
import { getStore } from '../sheets/index.js';
import { buildSalesSummary, loadPeriod } from './report.service.js';
import { getNumericSetting } from './settings.service.js';
import { toTransactionDto, toTransactionRecord, transactionsTable } from './transaction.service.js';

/**
 * KPI figures for the dashboard.
 *
 * Sales-shaped numbers come from the shared report aggregator so the dashboard
 * and the reports pages can never disagree. Operational counts (what is on the
 * floor right now) are deliberately NOT date-filtered — a shirt washed last
 * week that nobody has collected is still work in progress today.
 */
export async function getDashboardMetrics(
  from: string,
  to: string,
  label: string,
): Promise<DashboardMetrics> {
  const today = manilaDateKey();
  const previous = previousRange({ from, to });

  const [summary, previousSummary, period, table, customersTable] = await Promise.all([
    buildSalesSummary(from, to, label),
    buildSalesSummary(previous.from, previous.to, 'Previous'),
    loadPeriod(from, to),
    transactionsTable(),
    getStore().table(SHEETS.customers),
  ]);

  const allActive = table.rows
    .map(toTransactionRecord)
    .map(toTransactionDto)
    .filter((item) => item.status === 'Active');

  const pendingLaundry = allActive.filter((item) => item.orderStatus === 'Received').length;

  const readyForPickup = allActive.filter(
    (item) => item.orderStatus === 'Ready for Pickup',
  ).length;

  const pickedUpToday = allActive.filter(
    (item) => (item.datePickedUp ?? '').slice(0, 10) === today,
  ).length;

  const newCustomers = customersTable.rows.filter((row) => {
    const registered = row.get('Registration Date').slice(0, 10);
    return registered >= from && registered <= to;
  }).length;

  const paidTransactions = period.counted.filter((t) => t.paymentStatus === 'Paid').length;
  const partiallyPaid = period.counted.filter((t) => t.paymentStatus === 'Partially Paid').length;
  const unpaid = period.counted.filter((t) => t.paymentStatus === 'Unpaid').length;

  return {
    range: { from, to, label },
    sales: summary.totalSales,
    transactions: summary.totalTransactions,
    paidTransactions,
    unpaidTransactions: unpaid,
    partiallyPaidTransactions: partiallyPaid,
    outstandingBalance: summary.outstandingBalance,
    pendingLaundry,
    readyForPickup,
    pickedUpToday,
    customersServed: summary.customers,
    newCustomers,
    cashSales: summary.cashSales,
    gcashSales: summary.gcashSales,
    discounts: summary.discounts,
    additionalCharges: summary.additionalCharges,
    averageTransactionValue: summary.averageTransactionValue,
    previous: {
      sales: previousSummary.totalSales,
      transactions: previousSummary.totalTransactions,
    },
    salesGrowthPct: percentChange(summary.totalSales, previousSummary.totalSales),
    trend: summary.daily.map((day) => ({
      dateKey: day.dateKey,
      sales: day.sales,
      transactions: day.transactions,
    })),
  };
}

/**
 * Operational alerts. These describe work that needs a human, so they are
 * always evaluated against the live floor rather than a selected date range.
 */
export async function getAlerts(): Promise<AlertItem[]> {
  const slaDays = await getNumericSetting(SETTINGS_KEYS.pickupSlaDays, 2);
  const today = manilaDateKey();
  const table = await transactionsTable();

  const active = table.rows
    .map(toTransactionRecord)
    .map(toTransactionDto)
    .filter((item) => item.status === 'Active');

  const alerts: AlertItem[] = [];

  const ready = active.filter((item) => item.orderStatus === 'Ready for Pickup');
  if (ready.length > 0) {
    alerts.push({
      id: 'ready-for-pickup',
      severity: 'info',
      title: ready.length + (ready.length === 1 ? ' order is' : ' orders are') + ' ready for pickup.',
      detail: 'Customers can be notified that their laundry is waiting.',
      count: ready.length,
      href: '/pickup',
    });
  }

  const overdue = ready.filter((item) => {
    const since = item.expectedPickup || item.transactionDate;
    return daysBetweenKeys(since, today) > slaDays;
  });
  if (overdue.length > 0) {
    alerts.push({
      id: 'pickup-backlog',
      severity: 'warning',
      title:
        overdue.length +
        (overdue.length === 1 ? ' order has' : ' orders have') +
        ' been waiting more than ' +
        slaDays +
        ' days.',
      detail: 'Follow up with these customers to clear the shelf.',
      count: overdue.length,
      href: '/pickup',
    });
  }

  const owing = active.filter(
    (item) => item.balance > 0 && item.paymentStatus !== 'Refunded',
  );
  if (owing.length > 0) {
    const total = owing.reduce((sum, item) => sum + item.balance, 0);
    alerts.push({
      id: 'outstanding-balances',
      severity: 'danger',
      title:
        owing.length +
        (owing.length === 1 ? ' transaction has' : ' transactions have') +
        ' an outstanding balance.',
      detail: 'Total owed: ' + total.toFixed(2),
      count: owing.length,
      href: '/transactions?paymentStatus=Unpaid',
    });
  }

  const releasedWithBalance = active.filter(
    (item) => item.orderStatus === 'Picked Up' && item.balance > 0,
  );
  if (releasedWithBalance.length > 0) {
    alerts.push({
      id: 'released-unpaid',
      severity: 'warning',
      title:
        releasedWithBalance.length +
        ' released ' +
        (releasedWithBalance.length === 1 ? 'order' : 'orders') +
        ' still owe money.',
      detail: 'Laundry was collected before the balance was settled.',
      count: releasedWithBalance.length,
      href: '/transactions?paymentStatus=Partially%20Paid',
    });
  }

  return alerts;
}
