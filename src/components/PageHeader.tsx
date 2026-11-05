import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The title block at the top of every screen.
 *
 * On a phone the title gets more weight and the actions drop to a full-width
 * row beneath it rather than being squeezed alongside. Two reasons: a 20px
 * heading next to a button reads as a toolbar rather than a page, and a button
 * sharing a line with a long title wraps to something too narrow to hit with a
 * thumb. On a wide screen there is room for both, so they sit together.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 no-print sm:mb-5', className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight tracking-tight text-navy-900 sm:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 text-sm leading-snug text-slate-600 sm:mt-1">{subtitle}</p>
          ) : null}
        </div>

        {actions ? (
          <div
            className={cn(
              'flex items-center gap-2',
              // Full width on a phone so the primary action is a proper target;
              // `[&>*]:flex-1` makes a lone button stretch without needing every
              // caller to know about it.
              'max-sm:w-full max-sm:[&>*]:flex-1',
              'sm:flex-wrap sm:justify-end',
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
