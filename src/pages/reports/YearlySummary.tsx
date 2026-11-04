import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { manilaParts } from '@shared/datetime';
import type { YearlySummary as YearlySummaryDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import {
  DistributionPanels,
  ReportMeta,
  ServiceBreakdown,
  SummaryStats,
  TopCustomers,
} from '@/components/SummaryPanels';
import { GroupedBarChart } from '@/components/charts';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { peso } from '@/lib/format';

export default function YearlySummary() {
  useDocumentTitle('Yearly Summary');
  const currentYear = manilaParts().year;
  const [year, setYear] = useState(currentYear);

  const query = useQuery({
    queryKey: ['reports', 'yearly', year],
    queryFn: ({ signal }) => api.get<YearlySummaryDto>('/reports/yearly', { year }, signal),
    staleTime: 5 * 60_000,
  });

  const summary = query.data;
  const years = Array.from({ length: 6 }, (_, index) => currentYear - index);

  return (
    <>
      <PageHeader
        title="Yearly Summary"
        subtitle={'Annual performance for ' + year}
        actions={
          <>
            <Select
              aria-label="Year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              containerClassName="w-24"
              className="h-9"
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!summary}
              onClick={() =>
                summary &&
                exportCsv('yearly-' + year, summary.monthly, [
                  { header: 'Month', value: (row) => row.label },
                  { header: 'Sales', value: (row) => row.sales.toFixed(2) },
                  { header: 'Transactions', value: (row) => row.transactions },
                ])
              }
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
            >
              CSV
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

      {query.isError ? (
        <div className="card">
          <ErrorState
            title="Unable to load the yearly summary"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : query.isLoading || !summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <SummaryStats summary={summary} />
          <ReportMeta />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Year at a glance" />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Average per month</dt>
                    <dd className="font-medium tnum">{peso(summary.averageMonthlySales)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Best month</dt>
                    <dd className="font-medium tnum">
                      {summary.bestMonth
                        ? summary.bestMonth.label + ' \u00B7 ' + peso(summary.bestMonth.sales)
                        : '\u2014'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Lowest month</dt>
                    <dd className="font-medium tnum">
                      {summary.lowestMonth
                        ? summary.lowestMonth.label + ' \u00B7 ' + peso(summary.lowestMonth.sales)
                        : '\u2014'}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <dt className="font-medium text-navy-900">Customers</dt>
                    <dd className="font-semibold tnum">{summary.customers}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Monthly comparison" subtitle="Sales across all twelve months" />
              <CardBody>
                <GroupedBarChart
                  data={summary.monthly as unknown as Array<Record<string, string | number>>}
                  xKey="label"
                  xFormatter={(value: string) => value.slice(0, 3)}
                  bars={[{ key: 'sales', label: 'Sales', color: '#2589f0' }]}
                  height={280}
                />
              </CardBody>
            </Card>
          </div>

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
