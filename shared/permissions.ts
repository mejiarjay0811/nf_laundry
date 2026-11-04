import type { Role } from './constants.js';

/**
 * What an account is allowed to do, as capabilities rather than role checks.
 *
 * Naming the capability means a new role is one row in the table below, and
 * the question a route asks ("may this account see the profit figures?") is
 * the question the code actually spells. This table is the single source of
 * truth: the server enforces it, and the client reads the same table only so
 * it never offers a button the API would refuse.
 *
 * The separation of duties here is deliberate and unusual, so it is worth
 * stating plainly: ADMINISTRATION AND THE BUSINESS ARE SEPARATE JOBS.
 *
 *   Admin   the system administrator. Accounts, settings and the audit log —
 *           and nothing else. No till, no customers, no takings.
 *   Owner   the proprietor. The whole business, including the profit figures,
 *           but NOT the account and settings screens.
 *
 * So no single role can both change what the shop charges and quietly change
 * who is allowed to see it. That is the point. The cost is equally plain: the
 * owner cannot add a staff account without the admin login, so a shop run by
 * one person needs both.
 */

export const CAPABILITIES = [
  /* counter */
  'pos.sell',
  'orders.view',
  'orders.viewAll',
  'orders.edit',
  'orders.cancel',
  'orders.refund',

  /* customers */
  'customers.view',
  'customers.edit',
  'customers.viewSpending',

  /* cash handling */
  'shifts.operate',
  'shifts.viewAll',
  'shifts.reconcile',

  /* back of house */
  'gas.view',
  'gas.manage',
  'inventory.view',
  'inventory.manage',
  'machines.view',
  'machines.assign',
  'machines.manage',

  /* customer-facing extras */
  'loyalty.view',
  'loyalty.redeem',
  'loyalty.manage',


  /* money and reporting */
  'expenses.view',
  'expenses.manage',
  'reports.view',
  'reports.profit',

  /* messaging */
  'sms.send',

  /* the price list is a commercial decision, not an administrative one */
  'services.manage',

  /* administration — the Admin role's entire remit */
  'users.manage',
  'settings.manage',
  'audit.view',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The three administration permissions, named once.
 *
 * Used to assert the separation rather than trusting the table below to have
 * been written correctly — see `BUSINESS_ROLES` at the foot of this file.
 */
export const ADMINISTRATION: readonly Capability[] = [
  'users.manage',
  'settings.manage',
  'audit.view',
];

/** The proprietor: the whole shop, minus the administration screens. */
const OWNER: readonly Capability[] = [
  'pos.sell',
  'orders.view',
  'orders.viewAll',
  'orders.edit',
  'orders.cancel',
  'orders.refund',
  'customers.view',
  'customers.edit',
  'customers.viewSpending',
  'shifts.operate',
  'shifts.viewAll',
  'shifts.reconcile',
  'gas.view',
  'gas.manage',
  'inventory.view',
  'inventory.manage',
  'machines.view',
  'machines.assign',
  'machines.manage',
  'loyalty.view',
  'loyalty.redeem',
  'loyalty.manage',
  'expenses.view',
  'expenses.manage',
  'reports.view',
  'reports.profit',
  'sms.send',
  'services.manage',
];

/**
 * Runs the shop day to day.
 *
 * Everything the owner has except the two that decide what the business is
 * worth and what it keeps: the profit figures, and the power to write off an
 * expense. A manager can see what was spent; only the owner records it.
 */
const MANAGER: readonly Capability[] = OWNER.filter(
  (capability) => capability !== 'reports.profit' && capability !== 'expenses.manage',
);

/**
 * The counter.
 *
 * Deliberately no `orders.viewAll`: staff are served only orders that still
 * owe money, which the server applies on every transaction read. No customer
 * spending either — what someone has spent over their life is the owner's
 * figure, not the cashier's.
 */
const STAFF: readonly Capability[] = [
  'pos.sell',
  'orders.view',
  'customers.view',
  'customers.edit',
  'shifts.operate',
  'machines.view',
  'machines.assign',
  'loyalty.view',
  'loyalty.redeem',
];

/** Looks, never touches — an accountant or a silent partner. */
const VIEWER: readonly Capability[] = [
  'orders.view',
  'orders.viewAll',
  'customers.view',
  'customers.viewSpending',
  'inventory.view',
  'gas.view',
  'machines.view',
  'expenses.view',
  'reports.view',
  'shifts.viewAll',
];

/** The system administrator. Accounts, settings, the audit log. Nothing else. */
const ADMIN: readonly Capability[] = ADMINISTRATION;

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  Owner: OWNER,
  Admin: ADMIN,
  Manager: MANAGER,
  Staff: STAFF,
  Viewer: VIEWER,
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

/**
 * The proprietor's view of the books.
 *
 * Note this is NOT "is an administrator": an Admin fails it, because an Admin
 * has no business reading the takings. Used where the question really is "is
 * this the owner?" — the profit figures, a customer's lifetime spend.
 */
export function isOwnerRole(role: Role): boolean {
  return role === 'Owner';
}

/** Whether this account may reach the administration screens at all. */
export function isAdministrator(role: Role): boolean {
  return role === 'Admin';
}

/**
 * Roles that run the business rather than the system.
 *
 * Asserted rather than assumed: if someone later adds an administration
 * capability to a business role, this is what notices. It is a plain function
 * so the check can be made in a test without reaching into the table.
 */
export const BUSINESS_ROLES: readonly Role[] = ['Owner', 'Manager', 'Staff', 'Viewer'];

export function holdsAnyAdministration(role: Role): boolean {
  return ADMINISTRATION.some((capability) => can(role, capability));
}

/** Human wording for the role chips and the user list. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Owner: 'The whole business: the till, the books and the profit. Not accounts or settings.',
  Admin: 'Accounts, settings and the audit log only. No access to the shop or its takings.',
  Manager: 'Runs the shop day to day. No profit figures, and cannot record expenses.',
  Staff: 'The counter: sales, pickups, customers and their own cash shift.',
  Viewer: 'Read-only across the shop. Cannot change anything.',
};
