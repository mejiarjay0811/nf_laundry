/**
 * Centralised constants shared by the client and the server.
 * Nothing in this file may import runtime-specific modules.
 */

export const APP_NAME = 'N & F LAUNDRY';
export const APP_SHORT = 'N&F';
export const CURRENCY_SYMBOL = '\u20B1'; // Philippine Peso
export const TIMEZONE = 'Asia/Manila';

/* ------------------------------------------------------------------ roles */

/**
 * Who works here.
 *
 * Owner and Admin carry identical powers: every account on the sheet predates
 * the wider list and says "Admin", and renaming live rows would be a migration
 * that buys nothing. What each role may actually do lives in
 * shared/permissions.ts, not in comparisons scattered through the code.
 */
export const ROLES = ['Owner', 'Admin', 'Manager', 'Staff', 'Viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Anything else on the sheet is treated as the least-privileged role. */
export function normaliseRole(value: string): Role {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : 'Viewer';
}

/* --------------------------------------------------------------- statuses */

/**
 * Operational laundry workflow. Single source of truth for an order.
 *
 * Deliberately three states, not six. Stepping every load through
 * Washing/Drying/Folding meant five clicks per order for information nobody
 * acted on; what the counter actually needs to know is whether a load is still
 * being worked on, waiting on the shelf, or gone.
 */
export const ORDER_STATUSES = [
  'Received',
  'Ready for Pickup',
  'Picked Up',
  'Cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Stages from the earlier six-state workflow. Rows written before the change
 * still carry these, so reads fold them back to 'Received' (still in progress)
 * rather than showing a status the app no longer offers.
 */
export const LEGACY_ORDER_STATUSES = ['Washing', 'Drying', 'Folding'] as const;

export function normaliseOrderStatus(value: string): OrderStatus {
  if ((LEGACY_ORDER_STATUSES as readonly string[]).includes(value)) return 'Received';
  if ((ORDER_STATUSES as readonly string[]).includes(value)) return value as OrderStatus;
  return 'Received';
}

/** Legal forward/backward transitions. Cancelling has its own guarded action. */
export const ORDER_FLOW: readonly OrderStatus[] = [
  'Received',
  'Ready for Pickup',
  'Picked Up',
];

/** Derived from OrderStatus — never stored independently. */
export const PICKUP_STATUSES = ['Pending', 'Ready', 'Picked Up', 'Cancelled'] as const;
export type PickupStatus = (typeof PICKUP_STATUSES)[number];

/** Derived from money, except the two explicit terminal states. */
export const PAYMENT_STATUSES = [
  'Unpaid',
  'Partially Paid',
  'Paid',
  'Refunded',
  'Cancelled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Record lifecycle (soft delete). */
export const RECORD_STATUSES = ['Active', 'Cancelled'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const ENTITY_STATUSES = ['Active', 'Inactive'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const PAYMENT_MODES = ['Cash', 'GCash'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * A sale can be settled with more than one method — ₱100 cash and ₱75 GCash on
 * a ₱175 bill is routine. Each method is written as its own row in the Payments
 * ledger (which is what the cash/GCash reporting reads), and the transaction
 * row records this label so the receipt reads honestly.
 */
export const SPLIT_PAYMENT_LABEL = 'Cash + GCash';

/** What the transaction row's "Mode of Payment" column may contain. */
export type TransactionPaymentMode = PaymentMode | typeof SPLIT_PAYMENT_LABEL | '';

export function describePaymentModes(modes: PaymentMode[]): TransactionPaymentMode {
  const unique = [...new Set(modes)];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0] as PaymentMode;
  return SPLIT_PAYMENT_LABEL;
}

/* ----------------------------------------------------------------- audit */

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'CUSTOMER_CREATE',
  'CUSTOMER_UPDATE',
  'TRANSACTION_CREATE',
  'TRANSACTION_UPDATE',
  'TRANSACTION_CANCEL',
  'PAYMENT_RECORD',
  'PAYMENT_REFUND',
  'STATUS_UPDATE',
  'PICKUP_UPDATE',
  'SERVICE_CREATE',
  'SERVICE_UPDATE',
  'PRICE_CHANGE',
  'USER_CREATE',
  'USER_UPDATE',
  'PASSWORD_RESET',
  'SETTINGS_UPDATE',
  'SHEET_INIT',
  'DATA_RESET',
  'SHIFT_OPEN',
  'SHIFT_CLOSE',
  'CASH_MOVEMENT',
  'MACHINE_CREATE',
  'MACHINE_UPDATE',
  'MACHINE_ASSIGN',
  'MACHINE_RELEASE',
  'GAS_TANK_CREATE',
  'GAS_TANK_INSTALL',
  'GAS_TANK_EMPTY',
  'GAS_LOG',
  'LOYALTY_EARN',
  'LOYALTY_REDEEM',
  'LOYALTY_ADJUST',
  'REWARD_CREATE',
  'REWARD_UPDATE',
  'MESSAGE_QUEUE',
  'MESSAGE_SEND',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_MODULES = [
  'Auth',
  'Customers',
  'Transactions',
  'Payments',
  'Pickup',
  'Services',
  'Users',
  'Settings',
  'System',
  'Inventory',
  'Expenses',
  'Shifts',
  'Machines',
  'Gas',
  'Loyalty',
  'Messages',
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

/* ------------------------------------------------- inventory and expenses */

/** What the shop keeps on the shelf to run the machines. */
export const INVENTORY_CATEGORIES = [
  'Detergent',
  'Fabric Conditioner',
  'Bleach',
  'Packaging',
  'Machine Supplies',
  'Other',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/** Units a laundry actually buys in. */
export const INVENTORY_UNITS = ['kg', 'L', 'pc', 'pack', 'bottle', 'sack', 'box'] as const;

/**
 * Why a stock level changed. Every movement is recorded rather than the count
 * being quietly overwritten, so a discrepancy can be traced back.
 */
export const STOCK_MOVEMENTS = ['Restock', 'Used', 'Wastage', 'Correction'] as const;
export type StockMovement = (typeof STOCK_MOVEMENTS)[number];

/**
 * Expense categories. Salary is listed first because it is the one the shop
 * records most often, and 'Supplies' is what an inventory restock books itself
 * against so the two features agree.
 */
export const EXPENSE_CATEGORIES = [
  'Salary',
  'Supplies',
  'Rent',
  'Utilities',
  'Maintenance',
  'Transport',
  'Other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/* ------------------------------------------------------------ sheet names */

export const SHEETS = {
  users: 'Users',
  customers: 'Customers',
  transactions: 'Transactions',
  payments: 'Payments',
  services: 'Services',
  auditLogs: 'AuditLogs',
  settings: 'Settings',
  counters: 'Counters',
  inventory: 'Inventory',
  stockMovements: 'StockMovements',
  expenses: 'Expenses',
  shifts: 'CashShifts',
  cashMovements: 'CashMovements',
  machines: 'Machines',
  machineUsage: 'MachineUsage',
  gasTanks: 'GasTanks',
  gasLogs: 'GasLogs',
  loyalty: 'LoyaltyLedger',
  rewards: 'Rewards',
  messages: 'Messages',
} as const;

export type SheetName = (typeof SHEETS)[keyof typeof SHEETS];

/* -------------------------------------------------------------- defaults */

export const DEFAULT_SERVICES = [
  { name: 'Wash/Dry', price: 175, description: 'Full service wash and dry', sortOrder: 1 },
  { name: 'Dry Only', price: 100, description: 'Drying service only', sortOrder: 2 },
  { name: 'Wash Only', price: 100, description: 'Washing service only', sortOrder: 3 },
] as const;

export const SETTINGS_KEYS = {
  businessName: 'business.name',
  businessAddress: 'business.address',
  businessContact: 'business.contact',
  businessEmail: 'business.email',
  businessLogo: 'business.logo',
  receiptHeader: 'receipt.header',
  receiptFooter: 'receipt.footer',
  receiptShowQr: 'receipt.showQr',
  receiptPaperWidth: 'receipt.paperWidth',
  orPrefix: 'transaction.orPrefix',
  orPadding: 'transaction.orPadding',
  txnPrefix: 'transaction.idPrefix',
  pickupSlaDays: 'ops.pickupSlaDays',
  allowStaffDiscount: 'ops.allowStaffDiscount',
  maxStaffDiscount: 'ops.maxStaffDiscount',
  defaultTurnaroundHours: 'ops.defaultTurnaroundHours',
  /**
   * The shop's usual staff wage. Kept here so recording payroll does not mean
   * remembering the figure each time — the expense form offers it, and it stays
   * editable because a week is not always the same.
   */
  staffSalary: 'ops.staffSalary',
  /**
   * Pesos of settled sale that earn one loyalty point. Zero — the default —
   * turns the scheme off entirely, so a shop that does not want points never
   * accidentally accrues a liability it has to honour later.
   */
  loyaltyPesosPerPoint: 'loyalty.pesosPerPoint',
  /** Months before unused points lapse. Zero means they never do. */
  loyaltyExpiryMonths: 'loyalty.expiryMonths',
  /** Provider for outbound SMS. Empty keeps messages queued but unsent. */
  smsProvider: 'sms.provider',
  smsSenderName: 'sms.senderName',
  staffSalaryPeriod: 'ops.staffSalaryPeriod',
} as const;

export const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTINGS_KEYS.businessName]: 'N & F LAUNDRY',
  [SETTINGS_KEYS.businessAddress]: '',
  [SETTINGS_KEYS.businessContact]: '',
  [SETTINGS_KEYS.businessEmail]: '',
  [SETTINGS_KEYS.businessLogo]: '',
  [SETTINGS_KEYS.receiptHeader]: 'N & F LAUNDRY',
  [SETTINGS_KEYS.receiptFooter]: 'Thank you for your business!',
  [SETTINGS_KEYS.receiptShowQr]: 'true',
  [SETTINGS_KEYS.receiptPaperWidth]: '80mm',
  [SETTINGS_KEYS.staffSalary]: '0',
  [SETTINGS_KEYS.staffSalaryPeriod]: 'Monthly',
  [SETTINGS_KEYS.orPrefix]: 'OR-',
  [SETTINGS_KEYS.orPadding]: '6',
  [SETTINGS_KEYS.txnPrefix]: 'NF',
  [SETTINGS_KEYS.pickupSlaDays]: '2',
  [SETTINGS_KEYS.allowStaffDiscount]: 'true',
  [SETTINGS_KEYS.maxStaffDiscount]: '50',
  [SETTINGS_KEYS.defaultTurnaroundHours]: '24',
  // Off by default. Points are a promise to the customer, and a shop should
  // switch that on deliberately rather than discover it already owes rewards.
  [SETTINGS_KEYS.loyaltyPesosPerPoint]: '0',
  [SETTINGS_KEYS.loyaltyExpiryMonths]: '0',
  [SETTINGS_KEYS.smsProvider]: '',
  [SETTINGS_KEYS.smsSenderName]: '',
};

export const COUNTER_KEYS = {
  orNumber: 'OR_NUMBER',
  customerId: 'CUSTOMER_ID',
  serviceId: 'SERVICE_ID',
  userId: 'USER_ID',
  paymentId: 'PAYMENT_ID',
  inventoryId: 'INVENTORY_ID',
  stockMovementId: 'STOCK_MOVEMENT_ID',
  expenseId: 'EXPENSE_ID',
  shiftId: 'SHIFT_ID',
  cashMovementId: 'CASH_MOVEMENT_ID',
  machineId: 'MACHINE_ID',
  machineUsageId: 'MACHINE_USAGE_ID',
  gasTankId: 'GAS_TANK_ID',
  gasLogId: 'GAS_LOG_ID',
  loyaltyId: 'LOYALTY_ID',
  rewardId: 'REWARD_ID',
  messageId: 'MESSAGE_ID',
} as const;

/* ------------------------------------------------- cash shifts */

/** A shift is open until it is counted; nothing else closes it. */
export const SHIFT_STATUSES = ['Open', 'Closed'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/**
 * Cash that moves in or out of the drawer for a reason other than a sale.
 * Sales are already in the Payments ledger, so counting them here too would
 * double them in the reconciliation.
 */
export const CASH_MOVEMENT_TYPES = ['Cash In', 'Cash Out', 'Drop', 'Float'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

/* ------------------------------------------------------ machines */

export const MACHINE_TYPES = ['Washer', 'Dryer'] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

export const MACHINE_STATUSES = ['Available', 'In Use', 'Maintenance', 'Retired'] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

/* ----------------------------------------------------------- gas */

/**
 * A tank's life: delivered full, put on the line, run down, sent back. Cost
 * per run is only meaningful once a tank reaches Empty, because that is the
 * first moment the shop knows how many cycles it actually gave.
 */
export const GAS_TANK_STATUSES = ['Full', 'In Use', 'Empty', 'Returned'] as const;
export type GasTankStatus = (typeof GAS_TANK_STATUSES)[number];

export const GAS_LOG_TYPES = ['Refill', 'Install', 'Consumption', 'Return'] as const;
export type GasLogType = (typeof GAS_LOG_TYPES)[number];

/* ------------------------------------------------------- loyalty */

export const LOYALTY_TYPES = ['Earned', 'Redeemed', 'Adjusted', 'Expired'] as const;
export type LoyaltyType = (typeof LOYALTY_TYPES)[number];

export const REWARD_TYPES = ['Discount', 'Free Service', 'Freebie'] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

/* ------------------------------------------------ pickup & delivery */

export const DELIVERY_TYPES = ['Pickup', 'Delivery'] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const DELIVERY_STATUSES = [
  'Unassigned',
  'Assigned',
  'In Transit',
  'Delivered',
  'Failed',
  'Cancelled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/* ------------------------------------------------------ messaging */

export const MESSAGE_CHANNELS = ['SMS'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * Queued rather than sent inline. A send is a third-party HTTP call that can
 * be slow or down, and a customer's text failing must never be what stops a
 * sale from being recorded.
 */
export const MESSAGE_STATUSES = ['Queued', 'Sent', 'Failed', 'Cancelled'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_TEMPLATES = {
  orderReceived: 'ORDER_RECEIVED',
  readyForPickup: 'READY_FOR_PICKUP',
  balanceReminder: 'BALANCE_REMINDER',
} as const;

/* --------------------------------------------------------------- limits */

export const LIMITS = {
  maxQuantity: 999,
  maxUnitPrice: 100_000,
  maxDiscount: 1_000_000,
  maxAdditionalCharge: 1_000_000,
  maxPaidAmount: 1_000_000,
  maxExpenseAmount: 1_000_000,
  maxStockQuantity: 100_000,
  maxPageSize: 200,
  defaultPageSize: 25,
  maxNotesLength: 500,
  maxCashAmount: 1_000_000,
  maxLoyaltyPoints: 1_000_000,
  maxGasKg: 1_000,
  maxCycles: 100_000,
  maxSmsLength: 459,
} as const;
