import { Link } from 'react-router-dom';
import {
  Boxes,
  HandCoins,
  PackageCheck,
  ReceiptText,
  Scale,
  Settings,
  Users,
  WashingMachine,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@shared/constants';
import { cn } from '@/lib/cn';

interface Action {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Flat fill and its hover, matching the service tiles on the till. */
  tone: string;
  adminOnly?: boolean;
}

/**
 * The jumps worth one tap from anywhere.
 *
 * Same flat, saturated treatment as the service tiles on the till, so the two
 * screens read as one app rather than two designs. Icons are the trade's own —
 * a washing machine for the till, a basket for pickup, detergent for stock —
 * because at a counter the picture is recognised before the label is read.
 */
const ACTIONS: Action[] = [
  { label: 'Point of Sale', to: '/pos', icon: WashingMachine, tone: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'Pickup Queue', to: '/pickup', icon: PackageCheck, tone: 'bg-emerald-600 hover:bg-emerald-700' },
  { label: 'Transactions', to: '/transactions', icon: ReceiptText, tone: 'bg-amber-500 hover:bg-amber-600' },
  { label: 'Customers', to: '/customers', icon: Users, tone: 'bg-violet-600 hover:bg-violet-700' },
  { label: 'Inventory', to: '/inventory', icon: Boxes, tone: 'bg-cyan-600 hover:bg-cyan-700', adminOnly: true },
  { label: 'Expenses', to: '/expenses', icon: HandCoins, tone: 'bg-rose-500 hover:bg-rose-600', adminOnly: true },
  { label: 'Profit', to: '/profit', icon: Scale, tone: 'bg-teal-600 hover:bg-teal-700', adminOnly: true },
  { label: 'Settings', to: '/settings', icon: Settings, tone: 'bg-slate-600 hover:bg-slate-700', adminOnly: true },
];

export function QuickActions({
  role,
  className,
  columns = 2,
}: {
  role: Role;
  className?: string;
  columns?: 2 | 3 | 4;
}) {
  const actions = ACTIONS.filter((action) => !action.adminOnly || role === 'Admin');

  return (
    <div
      className={cn(
        'grid gap-2',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-2 sm:grid-cols-3',
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.to}
            to={action.to}
            className={cn(
              'flex min-h-[76px] flex-col justify-between rounded-xl p-3 ring-1 ring-black/10',
              'transition-transform active:scale-[0.97]',
              action.tone,
            )}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/25">
              <Icon className="h-4.5 w-4.5 text-white" aria-hidden="true" />
            </span>
            <span className="mt-2 text-sm font-semibold leading-tight text-white">
              {action.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
