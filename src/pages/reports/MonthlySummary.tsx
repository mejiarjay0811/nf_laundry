import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { MONTH_NAMES, formatChartDate, manilaParts } from '@shared/datetime';
import type { MonthlySummary as MonthlySummaryDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import {
  DistributionPanels,
  ReportMeta,
  ServiceBreakdown,
  SummaryStats,
  TopCustomers,
} from '@/components/SummaryPanels';
import { SalesTrendChart } from '@/components/charts';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { peso } from '@/lib/format';

export default function MonthlySummary() {
  useDocumentTitle('Monthly Summary');
  const today = manilaParts();
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);

  const query = useQuery({
    queryKey: ['reports', 'monthly', year, month],
    queryFn: ({ signal }) =>
      api.get<MonthlySummaryDto>('/reports/monthly', { year, month }, signal),
    staleTime: 60_000,
  });

  const summary = query.data;
  const years = Array.from({ length: 6 }, (_, index) => today.year - index);

  return (
    <>
      <PageHeader
        title="Monthly Summary"
        subtitle={MONTH_NAMES[month - 1] + ' ' + year}
        actions={
          <>
            <Select
              aria-label="Month"
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              containerClassName="w-36"
              className="h-9"
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </Select>
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
                exportCsv('monthly-' + year + '-' + String(month).padStart(2, '0'), summary.daily, [
                  { header: 'Date', value: (row) => row.dateKey },
                  { header: 'Sales', value: (row) => row.sales.toFixed(2) },
                  { header: 'Transactions', value: (row) => row.transactions },
                  { header: 'Cash', value: (row) => row.cash.toFixed(2) },
                  { header: 'GCash', value: (row) => row.gcash.toFixed(2) },
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
            title="Unable to load the monthly summary"
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

          <Card>
            <CardHeader
              title="Daily trend"
              subtitle={
                'Average ' +
                peso(summary.averageDailySales) +
                ' per day' +
                (summary.bestDay
                  ? ' \u00B7 best day ' +
                    formatChartDate(summary.bestDay.dateKey) +
                    ' (' +
                    peso(summary.bestDay.sales) +
                    ')'
                  : '')
              }
            />
            <CardBody>
              <SalesTrendChart data={summary.daily} height={300} />
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
