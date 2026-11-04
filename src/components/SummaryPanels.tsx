import { Link } from 'react-router-dom';
import type { SalesSummary } from '@shared/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { DonutChart } from '@/components/charts';
import { peso } from '@/lib/format';

/**
 * Report building blocks shared by Sales and all four summary pages, so every
 * report presents the same numbers in the same way.
 */

export function SummaryStats({ summary }: { summary: SalesSummary }) {
  const tiles = [
    { label: 'Total sales', value: peso(summary.totalSales), accent: 'text-navy-900' },
    { label: 'Transactions', value: String(summary.totalTransactions), accent: 'text-navy-900' },
    { label: 'Cash collected', value: peso(summary.cashSales), accent: 'text-navy-900' },
    { label: 'GCash collected', value: peso(summary.gcashSales), accent: 'text-navy-900' },
    {
      label: 'Outstanding',
      value: peso(summary.outstandingBalance),
      accent: summary.outstandingBalance > 0 ? 'text-red-600' : 'text-emerald-700',
    },
    { label: 'Discounts', value: peso(summary.discounts), accent: 'text-navy-900' },
    { label: 'Extra charges', value: peso(summary.additionalCharges), accent: 'text-navy-900' },
    {
      label: 'Average sale',
      value: peso(summary.averageTransactionValue),
      accent: 'text-navy-900',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {tile.label}
          </p>
          <p className={'mt-1.5 text-xl font-bold tnum ' + tile.accent}>{tile.value}</p>
        </div>
      ))}
    </div>
  );
}

export function ServiceBreakdown({ summary }: { summary: SalesSummary }) {
  return (
    <Card>
      <CardHeader title="Service performance" subtitle="What the shop is actually selling" />
      {summary.byService.length === 0 ? (
        <EmptyState title="No sales for this period." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Service</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Loads</Th>
              <Th align="right">Sales</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {summary.byService.map((service) => (
              <Tr key={service.serviceType}>
                <Td className="font-medium">{service.serviceType}</Td>
                <Td align="right">{service.transactions}</Td>
                <Td align="right">{service.quantity}</Td>
                <Td align="right" className="font-medium">
                  {peso(service.sales)}
                </Td>
                <Td align="right" className="text-slate-500">
                  {summary.totalSales > 0
                    ? ((service.sales / summary.totalSales) * 100).toFixed(1) + '%'
                    : '\u2014'}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

export function TopCustomers({ summary }: { summary: SalesSummary }) {
  return (
    <Card>
      <CardHeader title="Top customers" subtitle="Highest spending in this period" />
      {summary.topCustomers.length === 0 ? (
        <EmptyState title="No customers in this period." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {summary.topCustomers.map((customer, index) => (
            <li key={customer.customerId}>
              <Link
                to={'/customers/' + customer.customerId}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 tnum">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-navy-900">
                    {customer.customerName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {customer.transactions} {customer.transactions === 1 ? 'order' : 'orders'}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-navy-900 tnum">
                  {peso(customer.spending)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DistributionPanels({ summary }: { summary: SalesSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader title="Payment method" subtitle="Money collected in this period" />
        <CardBody>
          <DonutChart
            data={summary.byPaymentMode.map((mode) => ({ name: mode.mode, value: mode.amount }))}
            valueFormatter={peso}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Service mix" subtitle="Share of sales" />
        <CardBody>
          <DonutChart
            data={summary.byService.map((service) => ({
              name: service.serviceType,
              value: service.sales,
            }))}
            valueFormatter={peso}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payment status" subtitle="Transactions by settlement" />
        <CardBody>
          <DonutChart
            data={summary.byPaymentStatus.map((status) => ({
              name: status.status,
              value: status.count,
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}

export function ReportMeta() {
  return (
    <p className="mb-4 text-xs text-slate-500 tnum">
      Sales are attributed to the transaction date. Cash and GCash figures are money actually
      collected in this period, which is what makes partial payments add up. Cancelled and
      refunded transactions are excluded.
    </p>
  );
}
