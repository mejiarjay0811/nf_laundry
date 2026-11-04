import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import {
  addDaysToKey,
  formatChartDate,
  formatLongDate,
  manilaDateKey,
  startOfWeekKey,
} from '@shared/datetime';
import type { WeeklySummary as WeeklySummaryDto } from '@shared/types';
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
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { peso } from '@/lib/format';

export default function WeeklySummary() {
  useDocumentTitle('Weekly Summary');
  const [anchor, setAnchor] = useState(startOfWeekKey(manilaDateKey()));

  const query = useQuery({
    queryKey: ['reports', 'weekly', anchor],
    queryFn: ({ signal }) => api.get<WeeklySummaryDto>('/reports/weekly', { anchor }, signal),
    staleTime: 60_000,
  });

  const summary = query.data;

  return (
    <>
      <PageHeader
        title="Weekly Summary"
        subtitle={
          summary
            ? formatLongDate(summary.weekStart + 'T00:00:00+08:00') +
              ' \u2013 ' +
              formatLongDate(summary.weekEnd + 'T00:00:00+08:00')
            : 'Week overview'
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnchor(addDaysToKey(anchor, -7))}
              icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={anchor >= startOfWeekKey(manilaDateKey())}
              onClick={() => setAnchor(addDaysToKey(anchor, 7))}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
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
            title="Unable to load the weekly summary"
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
              <CardHeader title="Week at a glance" />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Average daily sales</dt>
                    <dd className="font-medium tnum">{peso(summary.averageDailySales)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Best day</dt>
                    <dd className="font-medium tnum">
                      {summary.bestDay
                        ? formatChartDate(summary.bestDay.dateKey) +
                          ' \u00B7 ' +
                          peso(summary.bestDay.sales)
                        : '\u2014'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Customers</dt>
                    <dd className="font-medium tnum">{summary.customers}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <dt className="font-medium text-navy-900">Collected</dt>
                    <dd className="font-semibold tnum">{peso(summary.collectedAmount)}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Daily sales" subtitle="Cash and GCash collections" />
              <CardBody>
                <GroupedBarChart
                  data={summary.daily as unknown as Array<Record<string, string | number>>}
                  xKey="dateKey"
                  xFormatter={formatChartDate}
                  bars={[
                    { key: 'cash', label: 'Cash', color: '#0f766e' },
                    { key: 'gcash', label: 'GCash', color: '#2589f0' },
                  ]}
                  height={260}
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
