import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { ProfitSummaryDto } from '@shared/types';
import { DateRangeFilter, type RangeValue } from '@/components/DateRangeFilter';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';

/** Exactly what the API's range filter accepts. */
const RANGE_PRESETS: ReadonlyArray<RangeValue['preset']> = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'this_year',
  'last_7_days',
  'last_30_days',
  'custom',
];

/**
 * Takings against spending.
 *
 * The headline figure is built from money actually collected, not from sales
 * invoiced — subtracting real wages from an unpaid order would report a profit
 * that is not in the drawer. Both numbers are shown so the gap between them is
 * visible rather than glossed over.
 */
export default function Profit() {
  useDocumentTitle('Profit');
  const [searchParams, setSearchParams] = useSearchParams();

  /*
   * The preset comes from the URL, so it has to be checked rather than
   * trusted. Anything the API would reject is replaced with the default: a
   * mistyped or stale link should show this month, not an error where the
   * figures ought to be.
   */
  const requested = searchParams.get('preset');
  const preset: RangeValue['preset'] = RANGE_PRESETS.includes(
    requested as RangeValue['preset'],
  )
    ? (requested as RangeValue['preset'])
    : 'this_month';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const query = useQuery({
    queryKey: ['profit', { preset, from, to }],
    queryFn: ({ signal }) =>
      api.get<ProfitSummaryDto>(
        '/reports/profit',
        { preset, from: from || undefined, to: to || undefined },
        signal,
      ),
    // The four figures stay put while a new range loads, instead of the whole
    // summary vanishing and coming back.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const data = query.data;
  const positive = (data?.net ?? 0) >= 0;

  return (
    <>
      <PageHeader
        title="Profit"
        subtitle="What the shop collected, against what it spent."
      />

      <div className="mb-4">
        <DateRangeFilter
          value={{
            preset,
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          }}
          onChange={(next) => {
            const params = new URLSearchParams();
            if (next.preset) params.set('preset', next.preset);
            if (next.from) params.set('from', next.from);
            if (next.to) params.set('to', next.to);
            setSearchParams(params, { replace: true });
          }}
        />
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState
            title="Unable to load the summary"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardBody className="py-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Sales
                </p>
                <p className="mt-1.5 text-xl font-bold text-navy-900 tnum sm:text-2xl">
                  {peso(data.sales)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 tnum">
                  {data.transactionCount} transactions
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="py-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <Wallet className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                  Collected
                </p>
                <p className="mt-1.5 text-xl font-bold text-navy-900 tnum sm:text-2xl">
                  {peso(data.collected)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {data.sales > data.collected
                    ? peso(data.sales - data.collected) + ' still owed'
                    : 'All settled'}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="py-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <TrendingDown className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                  Expenses
                </p>
                <p className="mt-1.5 text-xl font-bold text-red-600 tnum sm:text-2xl">
                  {peso(data.expenses)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 tnum">{data.expenseCount} entries</p>
              </CardBody>
            </Card>

            <Card
              className={cn(
                'ring-1',
                positive ? 'ring-emerald-300 bg-emerald-50/40' : 'ring-red-300 bg-red-50/40',
              )}
            >
              <CardBody className="py-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                  Net
                </p>
                <p
                  className={cn(
                    'mt-1.5 text-xl font-bold tnum sm:text-2xl',
                    positive ? 'text-emerald-700' : 'text-red-700',
                  )}
                >
                  {peso(data.net)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Collected less expenses
                </p>
              </CardBody>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              title="Where the money went"
              subtitle={data.range.label}
            />
            {data.expensesByCategory.length === 0 ? (
              <EmptyState
                icon={<Wallet className="h-6 w-6" aria-hidden="true" />}
                title="No expenses in this period."
                message="Record wages, supplies and bills and they will be broken down here."
              />
            ) : (
              <CardBody className="space-y-3">
                {data.expensesByCategory.map((entry) => (
                  <div key={entry.category}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-navy-900">{entry.category}</span>
                      <span className="tnum">
                        <span className="font-semibold text-navy-900">{peso(entry.amount)}</span>
                        <span className="ml-2 text-xs text-slate-500">{entry.share}%</span>
                      </span>
                    </div>
                    {/* A bar rather than a pie: comparing lengths is easier than
                        comparing angles, and it stays readable on a phone. */}
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{ width: Math.max(2, entry.share) + '%' }}
                      />
                    </div>
                  </div>
                ))}
              </CardBody>
            )}
          </Card>

          <p className="mt-3 text-xs text-slate-500">
            Net uses money actually collected, not sales invoiced — an unpaid order is not
            income the shop has been handed.
          </p>
        </>
      ) : null}
    </>
  );
}
