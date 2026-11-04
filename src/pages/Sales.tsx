import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { formatChartDate } from '@shared/datetime';
import type { SalesSummary } from '@shared/types';
import { DateRangeFilter, type RangeValue } from '@/components/DateRangeFilter';
import { PageHeader } from '@/components/PageHeader';
import {
  DistributionPanels,
  ReportMeta,
  ServiceBreakdown,
  SummaryStats,
  TopCustomers,
} from '@/components/SummaryPanels';
import { GroupedBarChart, SalesTrendChart } from '@/components/charts';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { exportCsv } from '@/lib/csv';

export default function Sales() {
  useDocumentTitle('Sales');
  const [range, setRange] = useState<RangeValue>({ preset: 'this_month' });

  const query = useQuery({
    queryKey: ['reports', 'sales', range],
    queryFn: ({ signal }) =>
      api.get<SalesSummary>(
        '/reports/sales',
        { preset: range.preset, from: range.from, to: range.to },
        signal,
      ),
    staleTime: 60_000,
  });

  const summary = query.data;

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle={summary ? summary.range.label : 'Revenue and collections'}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!summary}
              onClick={() =>
                summary &&
                exportCsv('sales-' + summary.range.from + '-to-' + summary.range.to, summary.daily, [
                  { header: 'Date', value: (row) => row.dateKey },
                  { header: 'Sales', value: (row) => row.sales.toFixed(2) },
                  { header: 'Transactions', value: (row) => row.transactions },
                  { header: 'Cash', value: (row) => row.cash.toFixed(2) },
                  { header: 'GCash', value: (row) => row.gcash.toFixed(2) },
                ])
              }
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              icon={<Printer className="h-4 w-4" aria-hidden="true" />}
            >
              Print
            </Button>
          </>
        }
      />

      <DateRangeFilter value={range} onChange={setRange} className="mb-4 no-print" />

      {query.isError ? (
        <div className="card">
          <ErrorState
            title="Unable to load sales"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : query.isLoading || !summary ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <SummaryStats summary={summary} />
          <ReportMeta />

          <Card>
            <CardHeader title="Sales trend" subtitle={summary.range.label} />
            <CardBody>
              <SalesTrendChart data={summary.daily} height={300} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Cash vs GCash" subtitle="Collections by day" />
            <CardBody>
              <GroupedBarChart
                data={summary.daily as unknown as Array<Record<string, string | number>>}
                xKey="dateKey"
                xFormatter={formatChartDate}
                bars={[
                  { key: 'cash', label: 'Cash', color: '#0f766e' },
                  { key: 'gcash', label: 'GCash', color: '#2589f0' },
                ]}
                height={280}
              />
            </CardBody>
          </Card>

          <DistributionPanels summary={summary} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ServiceBreakdown summary={summary} />
            <TopCustomers summary={summary} />
          </div>
        </div>
      )}
    </>
  );
}
