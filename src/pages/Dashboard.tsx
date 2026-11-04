import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  HandCoins,
  PackageCheck,
  PhilippinePeso,
  ReceiptText as ReceiptIcon,
  Users as UsersIcon,
  WashingMachine,
} from 'lucide-react';
import type { AlertItem, DashboardMetrics } from '@shared/types';
import { DateRangeFilter, type RangeValue } from '@/components/DateRangeFilter';
import { GCashMark } from '@/components/GCashMark';
import { KpiCard } from '@/components/KpiCard';
import { QuickActions } from '@/components/QuickActions';
import { Clock } from '@/components/Clock';
import { PageHeader } from '@/components/PageHeader';
import { SalesTrendChart } from '@/components/charts';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, peso } from '@/lib/format';

function AlertsStrip({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {alerts.map((alert) => (
        <Link
          key={alert.id}
          to={alert.href ?? '/dashboard'}
          className={cn(
            'flex items-start gap-2.5 rounded-xl border p-3 transition-colors',
            alert.severity === 'danger'
              ? 'border-red-200 bg-red-50 hover:bg-red-100/70'
              : alert.severity === 'warning'
                ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/70'
                : 'border-brand-200 bg-brand-50 hover:bg-brand-100/70',
          )}
        >
          <AlertTriangle
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              alert.severity === 'danger'
                ? 'text-red-600'
                : alert.severity === 'warning'
                  ? 'text-amber-600'
                  : 'text-brand-600',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-navy-900">{alert.title}</span>
            <span className="block text-xs text-slate-600">{alert.detail}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth();
  const [range, setRange] = useState<RangeValue>({ preset: 'today' });

  const metrics = useQuery({
    queryKey: ['dashboard', 'metrics', range],
    queryFn: ({ signal }) =>
      api.get<DashboardMetrics>(
        '/dashboard/metrics',
        { preset: range.preset, from: range.from, to: range.to },
        signal,
      ),
    staleTime: 30_000,
  });

  const alerts = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: ({ signal }) =>
      api.get<{ items: AlertItem[] }>('/dashboard/alerts', undefined, signal),
    staleTime: 60_000,
  });

  const data = metrics.data;
  const loading = metrics.isLoading;

  // Share of collections, so the two tiles read as a split rather than two
  // unrelated numbers.
  const collected = (data?.cashSales ?? 0) + (data?.gcashSales ?? 0);
  const share = (value: number) =>
    collected > 0 ? Math.round((value / collected) * 100) + '% of collections' : undefined;
  const cashShare = data ? share(data.cashSales) : undefined;
  const gcashShare = data ? share(data.gcashSales) : undefined;

  return (
    <>
      <PageHeader
        title={'Good day, ' + (user?.fullName.split(' ')[0] ?? 'there')}
        subtitle={data ? data.range.label + ' overview' : 'Loading overview'}
        actions={<Clock />}
      />

      <DateRangeFilter value={range} onChange={setRange} className="mb-4" />

      {metrics.isError ? (
        <Card className="mb-4">
          <ErrorState
            title="Unable to load the dashboard"
            message={metrics.error instanceof Error ? metrics.error.message : undefined}
            onRetry={() => void metrics.refetch()}
          />
        </Card>
      ) : null}

      <AlertsStrip alerts={alerts.data?.items ?? []} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          loading={loading}
          label="Sales"
          value={peso(data?.sales ?? 0)}
          icon={<PhilippinePeso className="h-4 w-4" aria-hidden="true" />}
          accent="green"
          delta={data?.salesGrowthPct ?? null}
          deltaLabel="vs previous period"
          to="/sales"
        />
        <KpiCard
          loading={loading}
          label="Transactions"
          value={count(data?.transactions ?? 0)}
          icon={<ReceiptIcon className="h-4 w-4" aria-hidden="true" />}
          accent="brand"
          hint={data ? peso(data.averageTransactionValue) + ' average' : undefined}
          to="/transactions"
        />
        <KpiCard
          loading={loading}
          label="Ready for Pickup"
          value={count(data?.readyForPickup ?? 0)}
          icon={<PackageCheck className="h-4 w-4" aria-hidden="true" />}
          accent="amber"
          hint="Waiting on the shelf"
          to="/pickup"
        />
        <KpiCard
          loading={loading}
          label="Unpaid"
          value={count((data?.unpaidTransactions ?? 0) + (data?.partiallyPaidTransactions ?? 0))}
          icon={<HandCoins className="h-4 w-4" aria-hidden="true" />}
          accent="red"
          hint={data ? peso(data.outstandingBalance) + ' outstanding' : undefined}
          to="/transactions?paymentStatus=Unpaid"
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          loading={loading}
          label="Cash"
          value={peso(data?.cashSales ?? 0)}
          icon={<Banknote className="h-4 w-4" aria-hidden="true" />}
          accent="green"
          hint={cashShare}
        />
        <KpiCard
          loading={loading}
          label="GCash"
          value={peso(data?.gcashSales ?? 0)}
          icon={<GCashMark size="sm" />}
          accent="brand"
          hint={gcashShare}
        />
        <KpiCard
          loading={loading}
          label="In progress"
          value={count(data?.pendingLaundry ?? 0)}
          icon={<WashingMachine className="h-4 w-4" aria-hidden="true" />}
          accent="navy"
          hint="Not yet ready"
          to="/pickup"
        />
        <KpiCard
          loading={loading}
          label="Customers served"
          value={count(data?.customersServed ?? 0)}
          icon={<UsersIcon className="h-4 w-4" aria-hidden="true" />}
          accent="brand"
          hint={data ? data.newCustomers + ' new' : undefined}
          to="/customers"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Sales trend"
            subtitle={data?.range.label}
            action={
              <Link
                to="/sales"
                className="text-xs font-medium text-brand-700 hover:text-brand-800"
              >
                Open sales
              </Link>
            }
          />
          <CardBody>
            {loading ? (
              <Skeleton className="h-56 rounded-lg" />
            ) : (
              <SalesTrendChart data={data?.trend ?? []} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Quick actions" />
          <CardBody>
            <QuickActions role={user?.role ?? 'Staff'} columns={2} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
