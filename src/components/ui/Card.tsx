import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('card', className)}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      /* Tighter on a phone: this header repeats on every card, so a few
         pixels here is a card and a half of extra content down the page. */
      className={cn(
        'flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5',
        'sm:gap-3 sm:px-5 sm:py-3.5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-3 py-3 sm:px-5 sm:py-4', className)}>{children}</div>;
}
