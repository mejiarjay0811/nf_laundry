import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { formatLongDate, manilaDateKey } from '@shared/datetime';
import type { DailySummary as DailySummaryDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import {
  DistributionPanels,
  ReportMeta,
  ServiceBreakdown,
  SummaryStats,
  TopCustomers,
} from '@/components/SummaryPanels';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { exportCsv } from '@/lib/csv';
import { peso } from '@/lib/format';

export default function DailySummary() {
  useDocumentTitle('Daily Summary');
  const [date, setDate] = useState(manilaDateKey());

  const query = useQuery({
    queryKey: ['reports', 'daily', date],
    queryFn: ({ signal }) => api.get<DailySummaryDto>('/reports/daily', { date }, signal),
    staleTime: 60_000,
  });

  const summary = query.data;

  return (
    <>
      <PageHeader
        title="Daily Summary"
        subtitle={formatLongDate(date + 'T00:00:00+08:00')}
        actions={
          <>
            <input
              type="date"
              value={date}
              max={manilaDateKey()}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Report date"
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm focus:border-brand-500"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!summary}
              onClick={() =>
                summary &&
                exportCsv('daily-summary-' + date, summary.byService, [
                  { header: 'Service', value: (row) => row.serviceType },
                  { header: 'Orders', value: (row) => row.transactions },
                  { header: 'Loads', value: (row) => row.quantity },
                  { header: 'Sales', value: (row) => row.sales.toFixed(2) },
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
            title="Unable to load the daily summary"
            message={query.error instanceof Error ? query.error.message : undefined}
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
              <CardHeader title="Operations" subtitle="Where the day's work stands" />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Customers served</dt>
                    <dd className="font-medium tnum">{summary.customers}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Ready for pickup</dt>
                    <dd className="font-medium tnum">{summary.readyForPickup}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Picked up today</dt>
                    <dd className="font-medium tnum">{summary.pickedUp}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <dt className="font-medium text-navy-900">Collected</dt>
                    <dd className="font-semibold tnum">{peso(summary.collectedAmount)}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Loads by service" />
              <CardBody>
                {Object.keys(summary.serviceCounts).length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">
                    No transactions recorded for this day.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {Object.entries(summary.serviceCounts).map(([service, value]) => (
                      <li key={service} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 text-sm text-slate-600">{service}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full bg-brand-500"
                            style={{
                              width:
                                summary.totalTransactions > 0
                                  ? (value / summary.totalTransactions) * 100 + '%'
                                  : '0%',
                            }}
                          />
                        </span>
                        <span className="w-8 shrink-0 text-right text-sm font-medium tnum">
                          {value}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
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
