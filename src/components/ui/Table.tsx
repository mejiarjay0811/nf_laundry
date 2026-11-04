import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/**
 * Data tables scroll horizontally inside their own container so the page body
 * never scrolls sideways on a phone. Screens that need more than a scroll swap
 * to a card list at the `sm` breakpoint instead.
 */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
  scope = 'col',
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  scope?: 'col' | 'row';
}) {
  return (
    <th
      scope={scope}
      className={cn(
        'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5',
        'text-xs font-semibold uppercase tracking-wide text-slate-600',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-b border-slate-100 px-4 py-3 align-middle text-navy-800',
        align === 'right' && 'text-right tnum',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  if (!onClick) return <tr className={cn('bg-white', className)}>{children}</tr>;
  return (
    <tr
      onClick={onClick}
      tabIndex={0}
      role="link"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'cursor-pointer bg-white transition-colors hover:bg-slate-50 focus:bg-slate-50',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row',
        className,
      )}
    >
      <p className="text-xs text-slate-600 tnum">
        Showing <span className="font-medium text-navy-800">{first}</span>–
        <span className="font-medium text-navy-800">{last}</span> of{' '}
        <span className="font-medium text-navy-800">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
        >
          Previous
        </Button>
        <span className="px-1 text-xs text-slate-600 tnum">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
