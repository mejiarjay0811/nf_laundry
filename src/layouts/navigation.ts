import {
  ClipboardList,
  Coins,
  FileBarChart,
  Flame,
  Gift,
  LayoutDashboard,
  Package,
  PackageCheck,
  ReceiptText,
  Scale,
  ScrollText,
  Settings,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  WashingMachine,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '@shared/constants';
import { can, type Capability } from '@shared/permissions';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** The permission that makes this destination worth showing. */
  needs?: Capability;
  /** Matches child routes too, e.g. /customers/CUST-00001 */
  matchPrefix?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The sidebar, keyed on what an account may actually do.
 *
 * Note where Services sits: under the shop floor, not Administration. Setting
 * a price is a commercial decision the owner makes, and Administration here
 * means accounts, settings and the audit log — the system administrator's
 * remit, which no business role can reach.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, needs: 'reports.view' },
      { label: 'Point of Sale (POS)', to: '/pos', icon: ShoppingCart, needs: 'pos.sell' },
      { label: 'Pickup Queue', to: '/pickup', icon: PackageCheck, needs: 'orders.view' },
    ],
  },
  {
    label: 'Records',
    items: [
      {
        label: 'Transactions',
        to: '/transactions',
        icon: ReceiptText,
        matchPrefix: true,
        needs: 'orders.view',
      },
      {
        label: 'Customers',
        to: '/customers',
        icon: Users,
        matchPrefix: true,
        needs: 'customers.view',
      },
      { label: 'Loyalty', to: '/loyalty', icon: Gift, needs: 'loyalty.view' },
    ],
  },
  {
    label: 'Shop floor',
    items: [
      { label: 'Cash Shifts', to: '/shifts', icon: Coins, needs: 'shifts.operate' },
      { label: 'Machines', to: '/machines', icon: WashingMachine, needs: 'machines.view' },
      { label: 'Gas', to: '/gas', icon: Flame, needs: 'gas.view' },
      { label: 'Inventory', to: '/inventory', icon: Package, needs: 'inventory.view' },
      { label: 'Services', to: '/services', icon: Sparkles, needs: 'services.manage' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Sales', to: '/sales', icon: TrendingUp, needs: 'reports.view' },
      { label: 'Daily Summary', to: '/reports/daily', icon: ClipboardList, needs: 'reports.view' },
      { label: 'Weekly Summary', to: '/reports/weekly', icon: ClipboardList, needs: 'reports.view' },
      { label: 'Monthly Summary', to: '/reports/monthly', icon: FileBarChart, needs: 'reports.view' },
      { label: 'Yearly Summary', to: '/reports/yearly', icon: FileBarChart, needs: 'reports.view' },
      { label: 'Expenses', to: '/expenses', icon: Wallet, needs: 'expenses.view' },
      { label: 'Profit', to: '/profit', icon: Scale, needs: 'reports.profit' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', to: '/users', icon: UserCog, needs: 'users.manage' },
      { label: 'Audit Logs', to: '/audit-logs', icon: ScrollText, needs: 'audit.view' },
      { label: 'Settings', to: '/settings', icon: Settings, needs: 'settings.manage' },
    ],
  },
];

export function visibleNavigation(role: Role): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.needs || can(role, item.needs)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Where an account lands after signing in, and where it is sent if it reaches
 * somewhere it may not see.
 *
 * Each role opens on the screen it spends the day in: the owner on the
 * figures, the counter at the till, and the administrator on the account
 * list. Landing someone on a screen they cannot read would just be one more
 * tap before they start.
 */
export function landingPath(role: Role): string {
  if (can(role, 'reports.view')) return '/dashboard';
  if (can(role, 'pos.sell')) return '/pos';
  if (can(role, 'users.manage')) return '/users';
  if (can(role, 'orders.view')) return '/transactions';
  return '/settings';
}

/**
 * The destinations that matter most on a phone.
 *
 * Capped at five: the bar is thumb-width, and a sixth item makes every target
 * too narrow to hit while holding a basket.
 */
export function mobileNavigation(role: Role): NavItem[] {
  const candidates: NavItem[] = [
    { label: 'Home', to: '/dashboard', icon: LayoutDashboard, needs: 'reports.view' },
    { label: 'POS', to: '/pos', icon: ShoppingCart, needs: 'pos.sell' },
    { label: 'Pickup', to: '/pickup', icon: PackageCheck, needs: 'orders.view' },
    { label: 'Orders', to: '/transactions', icon: ReceiptText, matchPrefix: true, needs: 'orders.view' },
    { label: 'Customers', to: '/customers', icon: Users, matchPrefix: true, needs: 'customers.view' },
    { label: 'Users', to: '/users', icon: UserCog, needs: 'users.manage' },
    { label: 'Settings', to: '/settings', icon: Settings, needs: 'settings.manage' },
  ];

  return candidates.filter((item) => !item.needs || can(role, item.needs)).slice(0, 5);
}
