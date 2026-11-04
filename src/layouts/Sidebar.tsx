import { NavLink, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Role } from '@shared/constants';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { useOperationalCounts, type OperationalCounts } from '@/hooks/useOperationalCounts';
import { cn } from '@/lib/cn';
import { visibleNavigation } from './navigation';

interface SidebarProps {
  role: Role;
  fullName: string;
  open: boolean;
  onClose: () => void;
}

/**
 * The count to show beside a destination, if any.
 *
 * Only two places carry one, and both are work waiting to be done: laundry on
 * the shelf, and money not yet collected. A badge on everything would be
 * decoration; a badge on these two is a to-do list.
 */
export function badgeFor(
  to: string,
  counts: OperationalCounts,
): { value: number; tone: string } | null {
  if (to === '/pickup' && counts.readyForPickup > 0) {
    return { value: counts.readyForPickup, tone: 'bg-emerald-500 text-white' };
  }
  if (to === '/transactions' && counts.notPaid > 0) {
    return { value: counts.notPaid, tone: 'bg-red-500 text-white' };
  }
  return null;
}

export function Sidebar({ role, fullName, open, onClose }: SidebarProps) {
  const groups = visibleNavigation(role);
  const location = useLocation();
  const counts = useOperationalCounts();

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-navy-950/50 lg:hidden no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          'app-sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-slate-300',
          'transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          'no-print',
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.matchPrefix
                    ? location.pathname.startsWith(item.to)
                    : location.pathname === item.to;
                  const Icon = item.icon;
                  const badge = badgeFor(item.to, counts);
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-brand-600 font-medium text-white'
                            : 'text-slate-300 hover:bg-navy-800 hover:text-white',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                        {badge ? (
                          <span
                            className={cn(
                              'ml-auto min-w-5 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold leading-none tnum',
                              active ? 'bg-white/25 text-white' : badge.tone,
                            )}
                          >
                            {badge.value > 99 ? '99+' : badge.value}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-navy-800 px-3 py-3">
          <div className="px-2 pb-2">
            <p className="truncate text-sm font-medium text-white">{fullName}</p>
            <p className="text-xs text-slate-400">{role}</p>
          </div>
          <SignOutButton />

        </div>
      </aside>
    </>
  );
}
