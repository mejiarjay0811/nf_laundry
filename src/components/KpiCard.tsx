import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/States';

type Accent = 'navy' | 'brand' | 'green' | 'amber' | 'red' | 'slate';

const ACCENTS: Record<Accent, string> = {
  navy: 'bg-navy-50 text-navy-700',
  brand: 'bg-brand-50 text-brand-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  slate: 'bg-slate-100 text-slate-600',
};

export interface KpiCardProps {
  label: string;
  value: string;
  icon?: ReactNode;
  accent?: Accent;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  to?: string;
  loading?: boolean;
}

export function KpiCard({
  label,
  value,
  icon,
  accent = 'slate',
  hint,
  delta,
  deltaLabel,
  to,
  loading,
}: KpiCardProps) {
  if (loading) {
    return (
      <div className="card p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-7 w-28" />
        <Skeleton className="mt-3 h-3 w-16" />
      </div>
    );
  }

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon ? (
          <span className={cn('rounded-lg p-1.5', ACCENTS[accent])} aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-navy-900 tnum">{value}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {delta !== undefined && delta !== null ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-semibold tnum',
              delta >= 0 ? 'text-emerald-600' : 'text-red-600',
            )}
          >
            {delta >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {(delta >= 0 ? '+' : '') + delta.toFixed(1) + '%'}
          </span>
        ) : null}
        {hint || deltaLabel ? (
          <span className="truncate text-xs text-slate-500">{hint ?? deltaLabel}</span>
        ) : null}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="card card-hover block p-4 focus-visible:ring-2">
        {body}
      </Link>
    );
  }
  return <div className="card p-4">{body}</div>;
}
