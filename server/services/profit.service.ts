import { toPesos, type Centavos } from '../../shared/money.js';
import type { ProfitSummaryDto } from '../../shared/types.js';
import { expenseTotals } from './expense.service.js';
import { buildSalesSummary } from './report.service.js';

/**
 * What the shop earned against what it spent.
 *
 * Net is computed from money actually **collected**, not from sales invoiced.
 * An unpaid order is revenue the shop has not been handed, and subtracting real
 * expenses from money still owed would report a profit that is not in the
 * drawer. The gross sales figure is reported alongside so the gap between the
 * two is visible rather than hidden.
 */
export async function buildProfitSummary(
  from: string,
  to: string,
  label: string,
): Promise<ProfitSummaryDto> {
  const [sales, expenses] = await Promise.all([
    buildSalesSummary(from, to, label),
    expenseTotals(from, to),
  ]);

  const collectedC: Centavos = Math.round(sales.collectedAmount * 100);
  const netC = collectedC - expenses.totalC;

  const byCategory = [...expenses.byCategory.entries()]
    .map(([category, amountC]) => ({
      category,
      amount: toPesos(amountC),
      share: expenses.totalC > 0 ? Math.round((amountC / expenses.totalC) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    range: { from, to, label },
    sales: sales.totalSales,
    collected: sales.collectedAmount,
    expenses: toPesos(expenses.totalC),
    net: toPesos(netC),
    expensesByCategory: byCategory,
    transactionCount: sales.totalTransactions,
    expenseCount: expenses.count,
  };
}
