import {
  addDaysToKey,
  endOfMonthKey,
  manilaDateKey,
  manilaParts,
  resolveRange,
  startOfMonthKey,
  startOfWeekKey,
} from '../../shared/datetime.js';
import type { Role } from '../../shared/constants.js';
import { can, isOwnerRole, type Capability } from '../../shared/permissions.js';
import type { HealthStatus, SessionUser } from '../../shared/types.js';
import { env, runtimeName, runtimeUptimeSeconds } from '../env.js';
import { AppError, badRequest, forbidden, notFound, unauthenticated } from '../errors.js';
import { errorMeta, logger } from '../logger.js';
import { getStore } from '../sheets/index.js';
import { initialiseWorkbook, inspectWorkbook } from '../sheets/init.js';
import { auditFacets, listAuditLogs, recordAudit } from '../services/audit.service.js';
import {
  closeShift,
  listShifts,
  openShift,
  openShiftFor,
  recordCashMovement,
  reconcileShift,
} from '../services/shift.service.js';
import {
  createMachine,
  endUsage,
  listMachines,
  listUsage,
  startUsage,
  updateMachine,
} from '../services/machine.service.js';
import {
  gasSummary,
  installTank,
  listGasLogs,
  listTanks,
  markTankEmpty,
  recordTankPurchase,
} from '../services/gas.service.js';
import {
  adjustPoints,
  createReward,
  listEntries,
  listRewards,
  loyaltyBalance,
  redeemReward,
  updateReward,
} from '../services/loyalty.service.js';
import {
  cancelMessage,
  flushQueue,
  listMessages,
  queueMessage,
} from '../services/message.service.js';
import { trackOrder } from '../services/tracking.service.js';
import { previewReset, resetTransactionData } from '../services/maintenance.service.js';
import { currentUserDto, login, logout, resolveSession } from '../services/auth.service.js';
import { createService, listServices, seedServices, updateService } from '../services/catalog.service.js';
import {
  createCustomer,
  getCustomer,
  getCustomerStats,
  listCustomers,
  searchCustomers,
  suggestAddresses,
  updateCustomer,
} from '../services/customer.service.js';
import { getAlerts, getDashboardMetrics } from '../services/dashboard.service.js';
import {
  createExpense,
  listExpenses,
  updateExpense,
  voidExpense,
} from '../services/expense.service.js';
import {
  createInventoryItem,
  getInventoryItem,
  listInventory,
  listStockMovements,
  recordStockMovement,
  updateInventoryItem,
} from '../services/inventory.service.js';
import { buildProfitSummary } from '../services/profit.service.js';
import {
  listPaymentsForTransaction,
  recordPayment,
  refundTransaction,
} from '../services/payment.service.js';
import {
  buildSalesSummary,
  getDailySummary,
  getMonthlySummary,
  getWeeklySummary,
  getYearlySummary,
} from '../services/report.service.js';
import { createTransaction, updateTransaction } from '../services/sale.service.js';
import { globalSearch } from '../services/search.service.js';
import { isOrNumberTaken, suggestNextOrNumber } from '../services/sequence.service.js';
import {
  getBusinessProfile,
  getSettings,
  seedSettings,
  updateSettings,
} from '../services/settings.service.js';
import {
  findTransactionRecord,
  listTransactions,
  toTransactionDto,
} from '../services/transaction.service.js';
import {
  changeOwnPassword,
  createUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from '../services/user.service.js';
import { cancelTransaction, getPickupQueue, updateOrderStatus } from '../services/workflow.service.js';
import {
  auditQuerySchema,
  cancelTransactionSchema,
  changeOwnPasswordSchema,
  createCustomerSchema,
  createServiceSchema,
  createTransactionSchema,
  createExpenseSchema,
  createInventorySchema,
  createUserSchema,
  customerQuerySchema,
  dailyQuerySchema,
  expenseQuerySchema,
  inventoryQuerySchema,
  loginSchema,
  monthlyQuerySchema,
  rangeQuerySchema,
  recordPaymentSchema,
  refundSchema,
  resetPasswordSchema,
  searchQuerySchema,
  stockMovementSchema,
  transactionQuerySchema,
  updateCustomerSchema,
  updateExpenseSchema,
  updateInventorySchema,
  updateServiceSchema,
  updateSettingsSchema,
  updateStatusSchema,
  updateTransactionSchema,
  updateUserSchema,
  voidExpenseSchema,
  openShiftSchema,
  closeShiftSchema,
  cashMovementSchema,
  shiftQuerySchema,
  createMachineSchema,
  updateMachineSchema,
  startUsageSchema,
  usageQuerySchema,
  createTankSchema,
  emptyTankSchema,
  createRewardSchema,
  updateRewardSchema,
  redeemRewardSchema,
  adjustPointsSchema,
  messageQuerySchema,
  queueMessageSchema,
  flushQueueSchema,
  trackingQuerySchema,
  resetDataSchema,
  weeklyQuerySchema,
  yearlyQuerySchema,
} from '../validators/index.js';

/**
 * The application's entire API surface, expressed once.
 *
 * Both hosts run this same table: the Express server mounts it behind a single
 * endpoint, and the Apps Script deployment calls it from doPost. Keeping one
 * table is the point — an authorisation rule or a validation schema that
 * existed in only one of the two would be a security hole waiting to open.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RpcRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface RpcContext {
  ip: string;
  userAgent: string;
  /** Bearer token supplied by the caller, if any. */
  token: string | null;
}

export interface RpcResult {
  status: number;
  body: unknown;
  /** Set on sign-in; null asks the caller to discard any stored token. */
  token?: string | null;
  tokenMaxAgeMs?: number;
}

/**
 * What a route demands of the caller.
 *
 * 'public'  anyone, signed in or not
 * 'user'    any signed-in account
 * 'admin'   owner-level only
 * Capability  the named permission from shared/permissions.ts
 *
 * The first three predate the wider role list and are kept because rewriting
 * seventy working routes at once is how regressions get in. New routes name a
 * capability, which is the form that survives another role being added.
 */
type AuthRule = 'public' | 'user' | 'admin' | Capability;

interface HandlerInput {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  /** Present whenever the route's auth rule is 'user' or 'admin'. */
  user: SessionUser;
  ctx: RpcContext;
}

interface Reply {
  status?: number;
  body: unknown;
  token?: string | null;
  tokenMaxAgeMs?: number;
}

interface Route {
  method: HttpMethod;
  segments: string[];
  staticCount: number;
  auth: AuthRule;
  handle: (input: HandlerInput) => Promise<Reply>;
}

const routes: Route[] = [];

function route(
  method: HttpMethod,
  pattern: string,
  auth: AuthRule,
  handle: (input: HandlerInput) => Promise<Reply>,
): void {
  const segments = pattern.split('/').filter((part) => part.length > 0);
  routes.push({
    method,
    segments,
    staticCount: segments.filter((part) => !part.startsWith(':')).length,
    auth,
    handle,
  });
}

/* ------------------------------------------------------------------ system */

route('GET', '/system/health', 'public', async () => {
  const store = getStore();
  const status: HealthStatus = {
    ok: false,
    provider: store.gateway.name,
    spreadsheetId: null,
    sheetsReady: false,
    missingSheets: [],
    latencyMs: null,
    message: '',
  };

  try {
    status.latencyMs = await store.ping();
    const workbook = await inspectWorkbook(store);
    status.sheetsReady = workbook.ready;
    status.missingSheets = workbook.missing;
    status.ok = workbook.ready;
    status.message = workbook.ready
      ? 'Connected.'
      : 'Connected, but the workbook is missing required sheets. Run the setup command.';
  } catch (error) {
    logger.error('Health check failed', errorMeta(error));
    status.message =
      error instanceof AppError
        ? error.message
        : 'Unable to connect to the data server. Please check your connection and try again.';
  }

  return { status: status.ok ? 200 : 503, body: status };
});

route('GET', '/system/diagnostics', 'settings.manage', async () => {
  const store = getStore();
  const workbook = await inspectWorkbook(store);
  return {
    body: {
      provider: store.gateway.name,
      target: store.gateway.name === 'local' ? store.gateway.target : 'configured',
      cache: store.cacheStats(),
      cacheTtlSeconds: env.CACHE_TTL_SECONDS,
      workbook,
      node: runtimeName,
      uptimeSeconds: runtimeUptimeSeconds(),
    },
  };
});

route('POST', '/system/initialise', 'settings.manage', async ({ user }) => {
  const result = await initialiseWorkbook(getStore(), { seedServices, seedSettings });
  await recordAudit({ actor: user, action: 'SHEET_INIT', module: 'System', newValue: result });
  return { body: result };
});

/**
 * Clearing the trading history. Administration only, and the single most
 * destructive thing the API will do — so it is a POST with an exact phrase in
 * the body, never a DELETE that a mis-aimed request could trigger.
 */
route('GET', '/system/reset-preview', 'settings.manage', async () => ({
  body: await previewReset(),
}));

route('POST', '/system/reset-transactions', 'settings.manage', async ({ body, user }) => ({
  body: await resetTransactionData(resetDataSchema.parse(body).confirmation, user),
}));

route('POST', '/system/refresh-cache', 'settings.manage', async () => {
  getStore().invalidateAll();
  return { body: { ok: true } };
});

/* -------------------------------------------------------------------- auth */

route('POST', '/auth/login', 'public', async ({ body, ctx }) => {
  const input = loginSchema.parse(body);
  const result = await login(input.username, input.password, {
    ip: ctx.ip,
    userAgent: ctx.userAgent.slice(0, 120),
    remember: input.remember,
  });
  return {
    body: { user: result.user },
    token: result.token,
    tokenMaxAgeMs: result.maxAgeMs,
  };
});

route('POST', '/auth/logout', 'public', async ({ ctx }) => {
  if (ctx.token) {
    try {
      await logout(await resolveSession(ctx.token), ctx.ip);
    } catch {
      // An expired or invalid token still ends the session client-side.
    }
  }
  return { body: { ok: true }, token: null };
});

route('GET', '/auth/me', 'user', async ({ user }) => ({
  body: { user, profile: await currentUserDto(user.userId) },
}));

route('POST', '/auth/change-password', 'user', async ({ body, user }) => {
  const input = changeOwnPasswordSchema.parse(body);
  await changeOwnPassword(user.userId, input.currentPassword, input.newPassword);
  return { body: { ok: true } };
});

/* --------------------------------------------------------------- dashboard */

route('GET', '/dashboard/metrics', 'reports.view', async ({ query }) => {
  const input = rangeQuerySchema.parse(query);
  const range = resolveRange(input.preset, { from: input.from, to: input.to });
  return { body: await getDashboardMetrics(range.from, range.to, range.label) };
});

route('GET', '/dashboard/alerts', 'reports.view', async () => ({ body: { items: await getAlerts() } }));

route('GET', '/dashboard/search', 'customers.view', async ({ query }) => {
  const { q, limit } = searchQuerySchema.parse(query);
  return { body: await globalSearch(q, limit) };
});

/* --------------------------------------------------------------- customers */

/*
 * What a customer has spent over their lifetime is the owner's figure, not the
 * counter's. Staff need to know who someone is and what they still owe, which
 * is left intact; the running total is stripped here rather than merely hidden
 * in the interface, because the response itself is readable by anyone who can
 * make the request.
 */
function redactSpending<T extends { totalSpending: number }>(record: T, role: Role): T {
  return can(role, 'customers.viewSpending') ? record : { ...record, totalSpending: 0 };
}

route('GET', '/customers', 'customers.view', async ({ query, user }) => {
  const page = await listCustomers(customerQuerySchema.parse(query));
  return {
    body: { ...page, items: page.items.map((item) => redactSpending(item, user.role)) },
  };
});

route('GET', '/customers/search', 'customers.view', async ({ query, user }) => {
  const { q, limit } = searchQuerySchema.parse(query);
  const items = await searchCustomers(q, limit);
  return { body: { items: items.map((item) => redactSpending(item, user.role)) } };
});

route('GET', '/customers/address-suggestions', 'customers.edit', async ({ query }) => {
  const { q, limit } = searchQuerySchema.parse(query);
  return { body: { items: await suggestAddresses(q, limit) } };
});

route('POST', '/customers', 'customers.edit', async ({ body, user }) => ({
  status: 201,
  body: { customer: await createCustomer(createCustomerSchema.parse(body), user) },
}));

route('GET', '/customers/:customerId', 'customers.view', async ({ params, user }) => {
  const customerId = params.customerId as string;
  const [customer, stats] = await Promise.all([
    getCustomer(customerId),
    getCustomerStats(customerId),
  ]);
  // The outstanding balance stays: staff have to collect it.
  return {
    body: {
      customer: redactSpending(customer, user.role),
      stats: redactSpending(stats, user.role),
    },
  };
});

route('GET', '/customers/:customerId/transactions', 'orders.view', async ({ params, query }) => {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 25);
  return {
    body: await listTransactions({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? Math.min(pageSize, 200) : 25,
      customerId: params.customerId as string,
      includeCancelled: true,
      sortBy: 'date',
      sortDir: 'desc',
    }),
  };
});

route('PATCH', '/customers/:customerId', 'customers.edit', async ({ params, body, user }) => ({
  body: {
    customer: await updateCustomer(
      params.customerId as string,
      updateCustomerSchema.parse(body),
      user,
    ),
  },
}));

/* ------------------------------------------------------------ transactions */

/*
 * Staff see only what is still owed.
 *
 * Their job at this screen is collecting outstanding balances; the full
 * trading history is the owner's. Forcing the filter here rather than trusting
 * the client matters — the request is trivially editable, so a staff account
 * asking for everything would otherwise get everything.
 */
route('GET', '/transactions', 'orders.view', async ({ query, user }) => {
  const parsed = transactionQuerySchema.parse(query);
  const scoped = can(user.role, 'orders.viewAll')
    ? parsed
    : { ...parsed, outstanding: true, includeCancelled: false };
  return { body: await listTransactions(scoped) };
});

/**
 * O.R. helper for the POS: a suggested next number, plus whether the one the
 * cashier has typed is still free. Read-only — the real uniqueness check runs
 * inside the locked create flow, where it cannot be raced.
 */
route('GET', '/transactions/or-number', 'pos.sell', async ({ query }) => {
  const candidate = typeof query.value === 'string' ? query.value.trim() : '';
  const [suggestion, taken] = await Promise.all([
    suggestNextOrNumber(),
    candidate ? isOrNumberTaken(candidate) : Promise.resolve(false),
  ]);
  return { body: { suggestion, candidate, taken } };
});

route('GET', '/transactions/pickup-queue', 'orders.view', async ({ query }) => ({
  body: { items: await getPickupQueue({ includePickedUp: query.includePickedUp === 'true' }) },
}));

route('POST', '/transactions', 'pos.sell', async ({ body, user, ctx }) => {
  const result = await createTransaction(createTransactionSchema.parse(body), user, { ip: ctx.ip });
  return { status: result.replayed ? 200 : 201, body: result };
});

route('GET', '/transactions/:transactionId', 'orders.view', async ({ params }) => {
  const record = await findTransactionRecord(params.transactionId as string);
  if (!record) throw notFound('Transaction');
  return {
    body: {
      transaction: toTransactionDto(record),
      payments: await listPaymentsForTransaction(record.transactionId),
    },
  };
});

route('PATCH', '/transactions/:transactionId', 'orders.edit', async ({ params, body, user }) => ({
  body: {
    transaction: await updateTransaction(
      params.transactionId as string,
      updateTransactionSchema.parse(body),
      user,
    ),
  },
}));

route('POST', '/transactions/:transactionId/status', 'orders.view', async ({ params, body, user }) => ({
  body: {
    transaction: await updateOrderStatus(
      params.transactionId as string,
      updateStatusSchema.parse(body) as never,
      user,
    ),
  },
}));

route('POST', '/transactions/:transactionId/payments', 'pos.sell', async ({ params, body, user }) => {
  const result = await recordPayment(
    params.transactionId as string,
    recordPaymentSchema.parse(body),
    user,
  );
  return { status: result.replayed ? 200 : 201, body: result };
});

route('POST', '/transactions/:transactionId/cancel', 'orders.cancel', async ({ params, body, user }) => ({
  body: {
    transaction: await cancelTransaction(
      params.transactionId as string,
      cancelTransactionSchema.parse(body).reason,
      user,
    ),
  },
}));

route('POST', '/transactions/:transactionId/refund', 'orders.refund', async ({ params, body, user }) => ({
  body: {
    transaction: await refundTransaction(
      params.transactionId as string,
      refundSchema.parse(body).reason,
      user,
    ),
  },
}));

/* ------------------------------------------------------------ cash shifts */

/**
 * The cashier's own drawer. 'shifts.operate' rather than 'admin': the whole
 * point is that the person at the till opens and closes their own.
 */
route('GET', '/shifts/current', 'shifts.operate', async ({ user }) => ({
  body: { shift: await openShiftFor(user.userId) },
}));

route('GET', '/shifts', 'shifts.viewAll', async ({ query }) => ({
  body: await listShifts(shiftQuerySchema.parse(query)),
}));

route('POST', '/shifts', 'shifts.operate', async ({ body, user }) => ({
  status: 201,
  body: { shift: await openShift(openShiftSchema.parse(body), user) },
}));

route('GET', '/shifts/:shiftId', 'shifts.operate', async ({ params, user }) => {
  const result = await reconcileShift(params.shiftId as string);
  // Your own shift, or a manager's view of anyone's. Without this a cashier
  // could read another till's takings by guessing an id.
  if (result.shift.userId !== user.userId && !can(user.role, 'shifts.viewAll')) {
    throw forbidden();
  }
  return { body: result };
});

route('POST', '/shifts/:shiftId/close', 'shifts.operate', async ({ params, body, user }) => ({
  body: await closeShift(params.shiftId as string, closeShiftSchema.parse(body), user),
}));

route('POST', '/shifts/:shiftId/movements', 'shifts.operate', async ({ params, body, user }) => ({
  status: 201,
  body: {
    movement: await recordCashMovement(
      cashMovementSchema.parse({ ...(body as object), shiftId: params.shiftId }),
      user,
    ),
  },
}));

/* -------------------------------------------------------------- machines */

route('GET', '/machines', 'machines.view', async ({ query }) => ({
  body: { items: await listMachines(query.includeRetired === 'true') },
}));

route('POST', '/machines', 'machines.manage', async ({ body, user }) => ({
  status: 201,
  body: { machine: await createMachine(createMachineSchema.parse(body), user) },
}));

route('GET', '/machines/usage', 'machines.view', async ({ query }) => ({
  body: await listUsage(usageQuerySchema.parse(query)),
}));

route('PATCH', '/machines/:machineId', 'machines.manage', async ({ params, body, user }) => ({
  body: {
    machine: await updateMachine(
      params.machineId as string,
      updateMachineSchema.parse(body),
      user,
    ),
  },
}));

// Loading a drum is the counter's job, not a manager's, so this is
// 'machines.assign' rather than 'machines.manage'.
route('POST', '/machines/usage', 'machines.assign', async ({ body, user }) => ({
  status: 201,
  body: { usage: await startUsage(startUsageSchema.parse(body), user) },
}));

route('POST', '/machines/usage/:usageId/end', 'machines.assign', async ({ params, user }) => ({
  body: { usage: await endUsage(params.usageId as string, user) },
}));

/* ------------------------------------------------------------------- gas */

route('GET', '/gas', 'gas.view', async () => ({
  body: {
    summary: await gasSummary(),
    tanks: await listTanks(),
    logs: await listGasLogs(30),
  },
}));

route('POST', '/gas/tanks', 'gas.manage', async ({ body, user }) => ({
  status: 201,
  body: { tank: await recordTankPurchase(createTankSchema.parse(body), user) },
}));

route('POST', '/gas/tanks/:tankId/install', 'gas.manage', async ({ params, user }) => ({
  body: { tank: await installTank(params.tankId as string, user) },
}));

route('POST', '/gas/tanks/:tankId/empty', 'gas.manage', async ({ params, body, user }) => ({
  body: { tank: await markTankEmpty(params.tankId as string, emptyTankSchema.parse(body), user) },
}));

/* --------------------------------------------------------------- loyalty */

route('GET', '/loyalty/rewards', 'loyalty.view', async ({ query, user }) => ({
  body: {
    items: await listRewards(query.includeInactive === 'true' && can(user.role, 'loyalty.manage')),
  },
}));

route('POST', '/loyalty/rewards', 'loyalty.manage', async ({ body, user }) => ({
  status: 201,
  body: { reward: await createReward(createRewardSchema.parse(body), user) },
}));

route('PATCH', '/loyalty/rewards/:rewardId', 'loyalty.manage', async ({ params, body, user }) => ({
  body: {
    reward: await updateReward(params.rewardId as string, updateRewardSchema.parse(body), user),
  },
}));

route('GET', '/loyalty/:customerId', 'loyalty.view', async ({ params }) => ({
  body: {
    balance: await loyaltyBalance(params.customerId as string),
    entries: await listEntries(params.customerId as string, 25),
  },
}));

route('POST', '/loyalty/redeem', 'loyalty.redeem', async ({ body, user }) => ({
  body: await redeemReward(redeemRewardSchema.parse(body), user),
}));

route('POST', '/loyalty/adjust', 'loyalty.manage', async ({ body, user }) => ({
  status: 201,
  body: { entry: await adjustPoints(adjustPointsSchema.parse(body), user) },
}));

/* -------------------------------------------------------- order tracking */

/** The customer's own order, by receipt number plus surname. */
route('GET', '/public/track', 'public', async ({ query }) => {
  const parsed = trackingQuerySchema.parse(query);
  return { body: await trackOrder(parsed.orNumber, parsed.lastName) };
});

/* ------------------------------------------------------------- messaging */

route('GET', '/messages', 'sms.send', async ({ query }) => ({
  body: await listMessages(messageQuerySchema.parse(query)),
}));

route('POST', '/messages', 'sms.send', async ({ body, user }) => ({
  status: 201,
  body: { message: await queueMessage(queueMessageSchema.parse(body), user) },
}));

route('POST', '/messages/flush', 'sms.send', async ({ body, user }) => ({
  body: await flushQueue(flushQueueSchema.parse(body ?? {}).limit, user),
}));

route('POST', '/messages/:messageId/cancel', 'sms.send', async ({ params, user }) => ({
  body: { message: await cancelMessage(params.messageId as string, user) },
}));

/* ---------------------------------------------------------------- services */

route('GET', '/services', 'orders.view', async ({ query, user }) => ({
  body: {
    items: await listServices(
      query.includeInactive === 'true' && can(user.role, 'services.manage'),
    ),
  },
}));

// Pricing is administrator-only: staff may sell at the configured price but
// may not change it.
route('POST', '/services', 'services.manage', async ({ body, user }) => ({
  status: 201,
  body: { service: await createService(createServiceSchema.parse(body), user) },
}));

route('PATCH', '/services/:serviceId', 'services.manage', async ({ params, body, user }) => ({
  body: {
    service: await updateService(
      params.serviceId as string,
      updateServiceSchema.parse(body),
      user,
    ),
  },
}));

/* ------------------------------------------------------------------- users */

route('GET', '/users', 'users.manage', async () => ({ body: { items: await listUsers() } }));


route('POST', '/users', 'users.manage', async ({ body, user }) => ({
  status: 201,
  body: { user: await createUser(createUserSchema.parse(body), user) },
}));

route('PATCH', '/users/:userId', 'users.manage', async ({ params, body, user }) => {
  const input = updateUserSchema.parse(body);
  const userId = params.userId as string;
  if (userId === user.userId && (input.role === 'Staff' || input.status === 'Inactive')) {
    throw badRequest('You cannot remove your own administrator access.');
  }
  return { body: { user: await updateUser(userId, input, user) } };
});

route('POST', '/users/:userId/reset-password', 'users.manage', async ({ params, body, user }) => {
  const input = resetPasswordSchema.parse(body);
  await resetUserPassword(params.userId as string, input.password, user);
  return { body: { ok: true } };
});

/* ----------------------------------------------------------------- reports */

route('GET', '/reports/sales', 'reports.view', async ({ query }) => {
  const input = rangeQuerySchema.parse(query);
  const range = resolveRange(input.preset, { from: input.from, to: input.to });
  return { body: await buildSalesSummary(range.from, range.to, range.label) };
});

route('GET', '/reports/daily', 'reports.view', async ({ query }) => {
  const { date } = dailyQuerySchema.parse(query);
  return { body: await getDailySummary(date ?? manilaDateKey()) };
});

route('GET', '/reports/weekly', 'reports.view', async ({ query }) => {
  const { anchor } = weeklyQuerySchema.parse(query);
  const start = startOfWeekKey(anchor ?? manilaDateKey());
  return { body: await getWeeklySummary(start, addDaysToKey(start, 6)) };
});

route('GET', '/reports/monthly', 'reports.view', async ({ query }) => {
  const { year, month } = monthlyQuerySchema.parse(query);
  const today = manilaParts();
  const targetYear = year ?? today.year;
  const targetMonth = month ?? today.month;
  const anchor = targetYear + '-' + String(targetMonth).padStart(2, '0') + '-01';
  return {
    body: await getMonthlySummary(
      startOfMonthKey(anchor),
      endOfMonthKey(anchor),
      targetYear,
      targetMonth,
    ),
  };
});

route('GET', '/reports/yearly', 'reports.view', async ({ query }) => {
  const { year } = yearlyQuerySchema.parse(query);
  return { body: await getYearlySummary(year ?? manilaParts().year) };
});

/* ----------------------------------------------------------------- stock */

// Inventory and expenses are the owner's books, so every route here is Admin.

route('GET', '/inventory', 'inventory.view', async ({ query }) => ({
  body: { items: await listInventory(inventoryQuerySchema.parse(query)) },
}));

route('POST', '/inventory', 'inventory.manage', async ({ body, user }) => ({
  status: 201,
  body: { item: await createInventoryItem(createInventorySchema.parse(body), user) },
}));

route('GET', '/inventory/movements', 'inventory.view', async ({ query }) => {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 25);
  return {
    body: await listStockMovements(
      typeof query.itemId === 'string' ? query.itemId : undefined,
      Number.isFinite(page) ? page : 1,
      Number.isFinite(pageSize) ? Math.min(pageSize, 200) : 25,
    ),
  };
});

route('GET', '/inventory/:itemId', 'inventory.view', async ({ params }) => ({
  body: { item: await getInventoryItem(params.itemId as string) },
}));

route('PATCH', '/inventory/:itemId', 'inventory.manage', async ({ params, body, user }) => ({
  body: {
    item: await updateInventoryItem(
      params.itemId as string,
      updateInventorySchema.parse(body),
      user,
    ),
  },
}));

route('POST', '/inventory/:itemId/movements', 'inventory.manage', async ({ params, body, user }) => ({
  status: 201,
  body: await recordStockMovement(
    params.itemId as string,
    stockMovementSchema.parse(body) as never,
    user,
  ),
}));

/* -------------------------------------------------------------- expenses */

route('GET', '/expenses', 'expenses.view', async ({ query }) => ({
  body: await listExpenses(expenseQuerySchema.parse(query)),
}));

route('POST', '/expenses', 'expenses.manage', async ({ body, user }) => ({
  status: 201,
  body: { expense: await createExpense(createExpenseSchema.parse(body), user) },
}));

route('PATCH', '/expenses/:expenseId', 'expenses.manage', async ({ params, body, user }) => ({
  body: {
    expense: await updateExpense(
      params.expenseId as string,
      updateExpenseSchema.parse(body),
      user,
    ),
  },
}));

route('POST', '/expenses/:expenseId/void', 'expenses.manage', async ({ params, body, user }) => ({
  body: {
    expense: await voidExpense(
      params.expenseId as string,
      voidExpenseSchema.parse(body).reason,
      user,
    ),
  },
}));

/** Takings against spending for a period — the point of recording expenses. */
route('GET', '/reports/profit', 'reports.profit', async ({ query }) => {
  const input = rangeQuerySchema.parse(query);
  const range = resolveRange(input.preset, { from: input.from, to: input.to });
  return { body: await buildProfitSummary(range.from, range.to, range.label) };
});

/* -------------------------------------------------------------- audit logs */

// The audit trail is administrator-only.
route('GET', '/audit-logs', 'audit.view', async ({ query }) => ({
  body: await listAuditLogs(auditQuerySchema.parse(query)),
}));

route('GET', '/audit-logs/facets', 'audit.view', async () => ({ body: await auditFacets() }));

/* ---------------------------------------------------------------- settings */

// Every signed-in user needs the business profile to render receipts.
route('GET', '/settings', 'user', async () => ({
  body: { settings: await getSettings(), business: await getBusinessProfile() },
}));

route('PATCH', '/settings', 'settings.manage', async ({ body, user }) => ({
  body: { settings: await updateSettings(updateSettingsSchema.parse(body), user) },
}));

/* ---------------------------------------------------------------- dispatch */

interface Match {
  route: Route;
  params: Record<string, string>;
}

function matchRoute(method: HttpMethod, path: string): Match | 'method-mismatch' | null {
  const parts = path.split('?')[0]?.split('/').filter((part) => part.length > 0) ?? [];
  let best: Match | null = null;
  let pathExists = false;

  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < candidate.segments.length; i += 1) {
      const segment = candidate.segments[i] as string;
      const value = parts[i] as string;
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
      } else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    pathExists = true;
    if (candidate.method !== method) continue;

    // A literal segment always beats a parameter, so /transactions/or-number
    // cannot be swallowed by /transactions/:transactionId.
    if (!best || candidate.staticCount > best.route.staticCount) {
      best = { route: candidate, params };
    }
  }

  if (best) return best;
  return pathExists ? 'method-mismatch' : null;
}

/**
 * Does this account satisfy the route's rule?
 *
 * 'user' now admits every signed-in role rather than the original two. A Rider
 * or a Viewer reaching a 'user' route is still bounded by what the handler
 * does — the transaction reads scope themselves by role, and the write routes
 * all carry a capability or 'admin'.
 */
function satisfies(rule: Exclude<AuthRule, 'public'>, role: Role): boolean {
  if (rule === 'user') return true;
  if (rule === 'admin') return isOwnerRole(role);
  return can(role, rule);
}

/**
 * Resolve, authorise and run one request.
 *
 * Authorisation happens here, on the server, for every route. The session is
 * re-read from the Users sheet on each call, so a deactivated or demoted
 * account loses access at once; roles are never taken from the request.
 */
export async function handleRpc(request: RpcRequest, ctx: RpcContext): Promise<RpcResult> {
  const match = matchRoute(request.method, request.path);
  if (match === null) throw notFound('Endpoint ' + request.path);
  if (match === 'method-mismatch') {
    throw new AppError('NOT_FOUND', request.method + ' is not supported for ' + request.path + '.');
  }

  let user: SessionUser | null = null;
  if (match.route.auth !== 'public') {
    if (!ctx.token) throw unauthenticated();
    user = await resolveSession(ctx.token);
    if (!satisfies(match.route.auth, user.role)) throw forbidden();
  }

  const reply = await match.route.handle({
    params: match.params,
    query: request.query ?? {},
    body: request.body,
    user: user as SessionUser,
    ctx,
  });

  return {
    status: reply.status ?? 200,
    body: reply.body,
    token: reply.token,
    tokenMaxAgeMs: reply.tokenMaxAgeMs,
  };
}

/** Every registered route, for diagnostics and tests. */
export function listRoutes(): Array<{ method: string; path: string; auth: AuthRule }> {
  return routes.map((entry) => ({
    method: entry.method,
    path: '/' + entry.segments.join('/'),
    auth: entry.auth,
  }));
}
