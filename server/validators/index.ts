import { z } from 'zod';
import {
  CASH_MOVEMENT_TYPES,
  MACHINE_STATUSES,
  MACHINE_TYPES,
  MESSAGE_STATUSES,
  REWARD_TYPES,
  SHIFT_STATUSES,
  EXPENSE_CATEGORIES,
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  LIMITS,
  ORDER_FLOW,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  PICKUP_STATUSES,
  ROLES,
  STOCK_MOVEMENTS,
} from '../../shared/constants.js';
import { isValidDateKey } from '../../shared/datetime.js';

/** Reusable primitives. */
const dateKey = z
  .string()
  .refine(isValidDateKey, { message: 'Use a valid date in YYYY-MM-DD format.' });

const money = (max: number, label: string) =>
  z
    .number({ invalid_type_error: label + ' must be a number.' })
    .finite()
    .min(0, label + ' cannot be negative.')
    .max(max, label + ' is too large.');

const idempotencyKey = z
  .string()
  .min(8, 'Missing submission key.')
  .max(64, 'Invalid submission key.');

export const trimmed = (max: number) => z.string().trim().max(max);

/* -------------------------------------------------------------------- auth */

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(40),
  password: z.string().min(1, 'Enter your password.').max(200),
  remember: z.boolean().optional().default(false),
});

/* --------------------------------------------------------------- customers */

export const createCustomerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the customer name.').max(80),
  address: trimmed(160).optional(),
  // Optional: plenty of walk-ins do not leave a number. A number that IS given
  // still has to be plausible — a half-typed one is worse than none.
  contactNumber: z
    .string()
    .trim()
    .max(20, 'Contact number is too long.')
    .refine((value) => value === '' || value.replace(/\D/g, '').length >= 7, {
      message: 'Enter a valid contact number, or leave it blank.',
    })
    .optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
  /** Set after the cashier has been warned about a same-name match. */
  allowDuplicateName: z.boolean().optional(),
});

export const updateCustomerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(80).optional(),
    address: trimmed(160).optional(),
    contactNumber: z
      .string()
      .trim()
      .max(20)
      .refine((value) => value === '' || value.replace(/\D/g, '').length >= 7, {
        message: 'Enter a valid contact number, or leave it blank.',
      })
      .optional(),
    notes: trimmed(LIMITS.maxNotesLength).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

export const customerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
  search: z.string().trim().max(80).optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
  sortBy: z.enum(['name', 'recent', 'spending', 'transactions']).optional(),
});

/* ------------------------------------------------------------ transactions */

/** One method's share of the tender. A sale may settle with several. */
export const paymentLineSchema = z.object({
  modeOfPayment: z.enum(PAYMENT_MODES),
  amount: money(LIMITS.maxPaidAmount, 'Payment amount'),
  referenceNumber: trimmed(40).optional(),
});

/**
 * O.R. number as printed in the shop's BIR receipt booklet. Letters, digits,
 * dashes and slashes cover every booklet format we have seen; anything else is
 * far more likely to be a typo than a real receipt number.
 */
export const orNumberSchema = z
  .string()
  .trim()
  .min(1, 'Enter the O.R. number from the receipt.')
  .max(30, 'That O.R. number is too long.')
  .regex(/^[A-Za-z0-9/-]+$/, 'Use letters, numbers, dashes or slashes only.');

export const createTransactionSchema = z
  .object({
    orNumber: orNumberSchema,
    customerId: z.string().trim().max(20).optional(),
    newCustomer: createCustomerSchema.omit({ notes: true }).optional(),
    serviceId: z.string().trim().min(1, 'Select a service.').max(20),
    quantity: z
      .number()
      .int('Quantity must be a whole number.')
      .min(1, 'Quantity must be at least 1.')
      .max(LIMITS.maxQuantity),
    discount: money(LIMITS.maxDiscount, 'Discount').optional().default(0),
    additionalCharge: money(LIMITS.maxAdditionalCharge, 'Additional charge').optional().default(0),
    payments: z.array(paymentLineSchema).max(4).optional().default([]),
    notes: trimmed(LIMITS.maxNotesLength).optional(),
    expectedPickup: dateKey.nullable().optional(),
    idempotencyKey,
  })
  .refine((value) => Boolean(value.customerId) || Boolean(value.newCustomer), {
    message: 'Select an existing customer or enter details for a new one.',
    path: ['customerId'],
  });

export const updateTransactionSchema = z.object({
  quantity: z.number().int().min(1).max(LIMITS.maxQuantity).optional(),
  unitPrice: money(LIMITS.maxUnitPrice, 'Unit price').optional(),
  discount: money(LIMITS.maxDiscount, 'Discount').optional(),
  additionalCharge: money(LIMITS.maxAdditionalCharge, 'Additional charge').optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
  expectedPickup: dateKey.nullable().optional(),
  reason: z.string().trim().min(3, 'Give a reason for this correction.').max(200),
});

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
  search: z.string().trim().max(80).optional(),
  customerId: z.string().trim().max(20).optional(),
  serviceId: z.string().trim().max(20).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  orderStatus: z.enum(['Received', 'Washing', 'Drying', 'Folding', 'Ready for Pickup', 'Picked Up', 'Cancelled']).optional(),
  pickupStatus: z.enum(PICKUP_STATUSES).optional(),
  modeOfPayment: z.enum(PAYMENT_MODES).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  /** Orders that still owe money — Unpaid and Partially Paid together. */
  outstanding: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  includeCancelled: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  sortBy: z.enum(['date', 'total', 'customer', 'or']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const updateStatusSchema = z.object({
  orderStatus: z.enum(ORDER_FLOW as unknown as [string, ...string[]]),
  pickedUpBy: trimmed(80).optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
  acknowledgeBalance: z.boolean().optional(),
});

export const cancelTransactionSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for cancelling.').max(200),
});

/* ----------------------------------------------------------------- payments */

/**
 * A balance can be settled with one method or several — half cash, half GCash
 * is routine at the counter. `payments` is the general form; the single-amount
 * fields remain for the simple case and for older callers.
 */
export const recordPaymentSchema = z
  .object({
    amount: z
      .number({ invalid_type_error: 'Enter a payment amount.' })
      .positive('Payment must be greater than zero.')
      .max(LIMITS.maxPaidAmount)
      .optional(),
    modeOfPayment: z.enum(PAYMENT_MODES).optional(),
    referenceNumber: trimmed(40).optional(),
    payments: z.array(paymentLineSchema).min(1).max(4).optional(),
    notes: trimmed(200).optional(),
    idempotencyKey,
  })
  .refine(
    (value) =>
      (value.payments && value.payments.length > 0) ||
      (value.amount !== undefined && value.modeOfPayment !== undefined),
    { message: 'Enter a payment amount.', path: ['amount'] },
  );

export const refundSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for the refund.').max(200),
});

/* ----------------------------------------------------------------- services */

export const createServiceSchema = z.object({
  name: z.string().trim().min(2, 'Enter a service name.').max(60),
  description: trimmed(160).optional(),
  price: money(LIMITS.maxUnitPrice, 'Price').refine((v) => v > 0, 'Price must be greater than zero.'),
  unit: trimmed(20).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: trimmed(160).optional(),
    price: money(LIMITS.maxUnitPrice, 'Price').optional(),
    unit: trimmed(20).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

/* -------------------------------------------------------------------- users */

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores only.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
  fullName: z.string().trim().min(2, 'Enter the full name.').max(80),
  role: z.enum(ROLES),
  status: z.enum(['Active', 'Inactive']).optional(),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(80).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
});

export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.').max(200),
});

/* ----------------------------------------------------------------- settings */

export const updateSettingsSchema = z
  .record(z.string().max(2000))
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

/* ------------------------------------------------------------------ reports */

export const rangeQuerySchema = z.object({
  preset: z
    .enum([
      'today',
      'yesterday',
      'this_week',
      'this_month',
      'this_year',
      'last_7_days',
      'last_30_days',
      'custom',
    ])
    .default('today'),
  from: dateKey.optional(),
  to: dateKey.optional(),
});

export const dailyQuerySchema = z.object({ date: dateKey.optional() });

export const weeklyQuerySchema = z.object({ anchor: dateKey.optional() });

export const monthlyQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const yearlyQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(50),
  search: z.string().trim().max(80).optional(),
  action: z.string().trim().max(40).optional(),
  module: z.string().trim().max(40).optional(),
  username: z.string().trim().max(40).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

/* ------------------------------------------------ inventory and expenses */

export const inventoryQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  lowStockOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  includeInactive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const quantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .nonnegative('Quantity cannot be negative.')
  .max(LIMITS.maxStockQuantity, 'That quantity is out of range.');

export const createInventorySchema = z.object({
  name: z.string().trim().min(2, 'Enter the item name.').max(80),
  category: z.enum(INVENTORY_CATEGORIES),
  unit: z.enum(INVENTORY_UNITS),
  quantity: quantity.optional().default(0),
  unitCost: money(LIMITS.maxUnitPrice, 'Unit cost').optional().default(0),
  reorderLevel: quantity.optional().default(0),
  supplier: trimmed(80).optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
});

export const updateInventorySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    category: z.enum(INVENTORY_CATEGORIES).optional(),
    unit: z.enum(INVENTORY_UNITS).optional(),
    unitCost: money(LIMITS.maxUnitPrice, 'Unit cost').optional(),
    reorderLevel: quantity.optional(),
    supplier: trimmed(80).optional(),
    notes: trimmed(LIMITS.maxNotesLength).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

/**
 * A stock movement. The quantity is always positive — the direction comes from
 * the type, so a typed minus sign can never silently reverse a correction.
 */
export const stockMovementSchema = z.object({
  type: z.enum(STOCK_MOVEMENTS),
  quantity: z
    .number({ invalid_type_error: 'Enter a quantity.' })
    .positive('Enter a quantity greater than zero.')
    .max(LIMITS.maxStockQuantity),
  unitCost: money(LIMITS.maxUnitPrice, 'Unit cost').optional(),
  recordExpense: z.boolean().optional(),
  reason: trimmed(200).optional(),
});

export const expenseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
  search: z.string().trim().max(80).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  includeCancelled: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(2, 'Describe what the money was spent on.').max(160),
  amount: money(LIMITS.maxExpenseAmount, 'Amount').refine(
    (v) => v > 0,
    'Enter an amount greater than zero.',
  ),
  modeOfPayment: z.enum(PAYMENT_MODES).optional(),
  paidTo: trimmed(80).optional(),
  reference: trimmed(80).optional(),
  expenseDate: dateKey.optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
});

export const updateExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    description: z.string().trim().min(2).max(160).optional(),
    amount: money(LIMITS.maxExpenseAmount, 'Amount').optional(),
    modeOfPayment: z.enum(PAYMENT_MODES).optional(),
    paidTo: trimmed(80).optional(),
    expenseDate: dateKey.optional(),
    notes: trimmed(LIMITS.maxNotesLength).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

export const voidExpenseSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for voiding this.').max(200),
});
/* ------------------------------------------------------- cash shifts */

export const openShiftSchema = z.object({
  openingFloat: money(LIMITS.maxCashAmount, 'Opening float'),
  note: trimmed(LIMITS.maxNotesLength).optional(),
});

export const closeShiftSchema = z.object({
  countedCash: money(LIMITS.maxCashAmount, 'Counted cash'),
  note: trimmed(LIMITS.maxNotesLength).optional(),
});

export const cashMovementSchema = z.object({
  shiftId: z.string().trim().min(1, 'Select a shift.').max(20),
  type: z.enum(CASH_MOVEMENT_TYPES),
  amount: money(LIMITS.maxCashAmount, 'Amount'),
  reason: z.string().trim().min(2, 'Say what the money was for.').max(160),
  reference: trimmed(80).optional(),
});

export const shiftQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
  userId: trimmed(20).optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
});

/* --------------------------------------------------------- machines */

export const createMachineSchema = z.object({
  name: z.string().trim().min(1, 'Name the machine, e.g. "Washer 1".').max(60),
  type: z.enum(MACHINE_TYPES),
  capacityKg: z.coerce.number().min(0).max(500).optional(),
  location: trimmed(60).optional(),
  cycleMinutes: z.coerce.number().int().min(1).max(600).optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
});

export const updateMachineSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    location: trimmed(60).optional(),
    status: z.enum(MACHINE_STATUSES).optional(),
    capacityKg: z.coerce.number().min(0).max(500).optional(),
    cycleMinutes: z.coerce.number().int().min(1).max(600).optional(),
    lastServiceDate: dateKey.optional(),
    notes: trimmed(LIMITS.maxNotesLength).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

export const startUsageSchema = z.object({
  machineId: z.string().trim().min(1, 'Pick a machine.').max(20),
  transactionId: trimmed(24).optional(),
  orNumber: trimmed(24).optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
});

export const usageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
  machineId: trimmed(20).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
});

/* -------------------------------------------------------------- gas */

export const createTankSchema = z.object({
  label: z.string().trim().min(1, 'Label the tank, e.g. "Tank A".').max(40),
  supplier: trimmed(80).optional(),
  sizeKg: z.coerce.number().min(1).max(LIMITS.maxGasKg),
  purchaseCost: money(LIMITS.maxExpenseAmount, 'Purchase cost'),
  purchaseDate: dateKey.optional(),
  recordAsExpense: z.boolean().optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
});

export const emptyTankSchema = z.object({
  cyclesOverride: z.coerce.number().int().min(0).max(LIMITS.maxCycles).optional(),
  notes: trimmed(LIMITS.maxNotesLength).optional(),
});

/* ---------------------------------------------------------- loyalty */

export const createRewardSchema = z.object({
  name: z.string().trim().min(2, 'Name the reward.').max(60),
  description: trimmed(160).optional(),
  type: z.enum(REWARD_TYPES),
  pointsCost: z.coerce.number().int().min(1).max(LIMITS.maxLoyaltyPoints),
  discountAmount: money(LIMITS.maxDiscount, 'Discount').optional(),
  serviceId: trimmed(20).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export const updateRewardSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: trimmed(160).optional(),
    pointsCost: z.coerce.number().int().min(1).max(LIMITS.maxLoyaltyPoints).optional(),
    discountAmount: money(LIMITS.maxDiscount, 'Discount').optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

export const redeemRewardSchema = z.object({
  customerId: z.string().trim().min(1, 'Pick a customer.').max(20),
  rewardId: z.string().trim().min(1, 'Pick a reward.').max(20),
  transactionId: trimmed(24).optional(),
});

export const adjustPointsSchema = z.object({
  customerId: z.string().trim().min(1).max(20),
  points: z.coerce.number().int().refine((value) => value !== 0, 'Enter points to add or remove.'),
  reason: z.string().trim().min(3, 'Give a reason.').max(160),
});

/* -------------------------------------------------------- messaging */

export const messageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
  status: z.enum(MESSAGE_STATUSES).optional(),
});

export const queueMessageSchema = z.object({
  template: z.string().trim().min(1).max(40),
  contactNumber: z.string().trim().min(7).max(20),
  body: z.string().trim().max(LIMITS.maxSmsLength).optional(),
  customerId: trimmed(20).optional(),
  transactionId: trimmed(24).optional(),
});

export const flushQueueSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/* --------------------------------------------------------- tracking */

export const trackingQuerySchema = z.object({
  orNumber: z.string().trim().min(1, 'Enter the O.R. number from your receipt.').max(24),
  lastName: z.string().trim().min(2, 'Enter the surname on the order.').max(80),
});

/* ------------------------------------------------------- maintenance */

/**
 * Clearing the books. The phrase is required verbatim rather than a boolean:
 * a stray `{ confirm: true }` is far too easy to send by accident for an
 * operation that cannot be undone.
 */
export const resetDataSchema = z.object({
  confirmation: z.string().min(1, 'Type the confirmation phrase.'),
});
