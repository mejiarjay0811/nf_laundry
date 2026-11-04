import { SHEETS } from '../../shared/constants.js';
import type { SheetDefinition } from './gateway.js';

/**
 * The spreadsheet schema. Column ORDER here defines how rows are written;
 * reads resolve columns BY HEADER NAME, so a human reordering columns in the
 * sheet will not corrupt the data.
 */

export const USER_COLUMNS = [
  'User ID',
  'Username',
  'Password Hash',
  'Full Name',
  'Role',
  'Status',
  'Created At',
  'Last Login',
  'Updated At',
] as const;

export const CUSTOMER_COLUMNS = [
  'Customer ID',
  'Full Name',
  'Address',
  'Contact Number',
  'Registration Date',
  'Total Transactions',
  'Total Spending',
  'Last Transaction Date',
  'Status',
  'Notes',
  'Created At',
  'Updated At',
] as const;

export const TRANSACTION_COLUMNS = [
  'Transaction ID',
  'O.R. Number',
  'Customer ID',
  'Customer Name',
  'Contact Number',
  'Service ID',
  'Service Type',
  'Quantity',
  'Unit Price',
  'Subtotal',
  'Discount',
  'Additional Charge',
  'Total Payment',
  'Paid Amount',
  'Change',
  'Balance',
  'Payment Status',
  'Mode of Payment',
  'Order Status',
  'Transaction Date',
  'Date Paid',
  'Pickup Status',
  'Date Picked Up',
  'Picked Up By',
  'Expected Pickup',
  'Time Stamp',
  'Created By',
  'Updated By',
  'Status',
  'Notes',
  'Idempotency Key',
] as const;

export const PAYMENT_COLUMNS = [
  'Payment ID',
  'Transaction ID',
  'O.R. Number',
  'Customer ID',
  'Amount',
  'Mode of Payment',
  'Payment Date',
  'Received By',
  'Reference Number',
  'Notes',
  'Status',
  'Idempotency Key',
] as const;

export const SERVICE_COLUMNS = [
  'Service ID',
  'Name',
  'Description',
  'Price',
  'Unit',
  'Status',
  'Sort Order',
  'Created At',
  'Updated At',
] as const;

export const AUDIT_COLUMNS = [
  'Log ID',
  'User ID',
  'Username',
  'Action',
  'Module',
  'Entity ID',
  'Previous Value',
  'New Value',
  'Timestamp',
  'Session Info',
] as const;

/**
 * Stock the shop holds. The quantity here is the running balance; every change
 * to it is also written to StockMovements, so the number can always be
 * reconciled against what actually happened rather than being taken on trust.
 */
export const INVENTORY_COLUMNS = [
  'Item ID',
  'Name',
  'Category',
  'Unit',
  'Quantity',
  'Unit Cost',
  'Reorder Level',
  'Supplier',
  'Status',
  'Notes',
  'Created At',
  'Updated At',
] as const;

export const STOCK_MOVEMENT_COLUMNS = [
  'Movement ID',
  'Item ID',
  'Item Name',
  'Type',
  'Quantity',
  'Unit Cost',
  'Total Cost',
  'Balance After',
  'Expense ID',
  'Reason',
  'Recorded By',
  'Movement Date',
  'Created At',
] as const;

/**
 * Money going out. Deliberately shaped like the Payments ledger — an amount, a
 * method, a date and a soft-delete Status — so the two can be added up the same
 * way when reporting what the shop earned against what it spent.
 */
export const EXPENSE_COLUMNS = [
  'Expense ID',
  'Expense Date',
  'Category',
  'Description',
  'Amount',
  'Mode of Payment',
  'Paid To',
  'Reference',
  'Item ID',
  'Recorded By',
  'Status',
  'Notes',
  'Created At',
  'Updated At',
] as const;

/**
 * A cashier's shift from drawer count to drawer count.
 *
 * Expected cash is never stored: it is derived from the Payments ledger
 * between the open and close timestamps, plus the float and any cash
 * movements. Storing it would let the two disagree, and when they disagree the
 * ledger is right.
 */
export const SHIFT_COLUMNS = [
  'Shift ID',
  'User ID',
  'Username',
  'Full Name',
  'Opened At',
  'Closed At',
  'Opening Float',
  'Counted Cash',
  'Expected Cash',
  'Variance',
  'Status',
  'Opening Note',
  'Closing Note',
  'Closed By',
  'Created At',
  'Updated At',
] as const;

export const CASH_MOVEMENT_COLUMNS = [
  'Movement ID',
  'Shift ID',
  'Type',
  'Amount',
  'Reason',
  'Reference',
  'Recorded By',
  'Movement Date',
  'Status',
  'Created At',
] as const;

export const MACHINE_COLUMNS = [
  'Machine ID',
  'Name',
  'Type',
  'Capacity Kg',
  'Location',
  'Status',
  'Cycle Minutes',
  'Total Cycles',
  'Last Service Date',
  'Notes',
  'Created At',
  'Updated At',
] as const;

/**
 * One row per load put through a machine. This is what "actual usage by
 * machine" reads, and what divides a tank's cost across the runs it powered.
 */
export const MACHINE_USAGE_COLUMNS = [
  'Usage ID',
  'Machine ID',
  'Machine Name',
  'Machine Type',
  'Transaction ID',
  'O.R. Number',
  'Started At',
  'Ended At',
  'Minutes',
  'Operator',
  'Status',
  'Notes',
  'Created At',
] as const;

export const GAS_TANK_COLUMNS = [
  'Tank ID',
  'Label',
  'Supplier',
  'Size Kg',
  'Purchase Cost',
  'Purchase Date',
  'Installed At',
  'Emptied At',
  'Cycles Served',
  'Cost Per Cycle',
  'Expense ID',
  'Status',
  'Notes',
  'Created At',
  'Updated At',
] as const;

export const GAS_LOG_COLUMNS = [
  'Log ID',
  'Tank ID',
  'Tank Label',
  'Type',
  'Machine ID',
  'Cycles',
  'Estimated Kg',
  'Cost',
  'Recorded By',
  'Log Date',
  'Notes',
  'Status',
  'Created At',
] as const;

/**
 * Points as a ledger, not a balance column. A stored balance that disagrees
 * with its history cannot be argued with at the counter; a sum of rows can.
 */
export const LOYALTY_COLUMNS = [
  'Entry ID',
  'Customer ID',
  'Customer Name',
  'Type',
  'Points',
  'Balance After',
  'Transaction ID',
  'Reward ID',
  'Reason',
  'Recorded By',
  'Entry Date',
  'Expires At',
  'Status',
  'Created At',
] as const;

export const REWARD_COLUMNS = [
  'Reward ID',
  'Name',
  'Description',
  'Type',
  'Points Cost',
  'Discount Amount',
  'Service ID',
  'Status',
  'Sort Order',
  'Created At',
  'Updated At',
] as const;

export const MESSAGE_COLUMNS = [
  'Message ID',
  'Channel',
  'Template',
  'Customer ID',
  'Contact Number',
  'Body',
  'Status',
  'Transaction ID',
  'Provider Reference',
  'Error',
  'Attempts',
  'Queued At',
  'Sent At',
  'Created By',
] as const;

export const SETTINGS_COLUMNS = ['Key', 'Value', 'Updated At', 'Updated By'] as const;

export const COUNTER_COLUMNS = ['Name', 'Value', 'Updated At'] as const;

export const SHEET_DEFINITIONS: readonly SheetDefinition[] = [
  { name: SHEETS.users, headers: USER_COLUMNS, uniqueBy: ['User ID', 'Username'] },
  { name: SHEETS.customers, headers: CUSTOMER_COLUMNS, uniqueBy: ['Customer ID'] },
  {
    name: SHEETS.transactions,
    headers: TRANSACTION_COLUMNS,
    uniqueBy: ['Transaction ID', 'O.R. Number'],
  },
  { name: SHEETS.payments, headers: PAYMENT_COLUMNS, uniqueBy: ['Payment ID'] },
  { name: SHEETS.services, headers: SERVICE_COLUMNS, uniqueBy: ['Service ID'] },
  { name: SHEETS.auditLogs, headers: AUDIT_COLUMNS, uniqueBy: ['Log ID'] },
  { name: SHEETS.settings, headers: SETTINGS_COLUMNS, uniqueBy: ['Key'] },
  { name: SHEETS.counters, headers: COUNTER_COLUMNS, uniqueBy: ['Name'] },
  { name: SHEETS.inventory, headers: INVENTORY_COLUMNS, uniqueBy: ['Item ID'] },
  {
    name: SHEETS.stockMovements,
    headers: STOCK_MOVEMENT_COLUMNS,
    uniqueBy: ['Movement ID'],
  },
  { name: SHEETS.expenses, headers: EXPENSE_COLUMNS, uniqueBy: ['Expense ID'] },
  { name: SHEETS.shifts, headers: SHIFT_COLUMNS, uniqueBy: ['Shift ID'] },
  { name: SHEETS.cashMovements, headers: CASH_MOVEMENT_COLUMNS, uniqueBy: ['Movement ID'] },
  { name: SHEETS.machines, headers: MACHINE_COLUMNS, uniqueBy: ['Machine ID'] },
  { name: SHEETS.machineUsage, headers: MACHINE_USAGE_COLUMNS, uniqueBy: ['Usage ID'] },
  { name: SHEETS.gasTanks, headers: GAS_TANK_COLUMNS, uniqueBy: ['Tank ID'] },
  { name: SHEETS.gasLogs, headers: GAS_LOG_COLUMNS, uniqueBy: ['Log ID'] },
  { name: SHEETS.loyalty, headers: LOYALTY_COLUMNS, uniqueBy: ['Entry ID'] },
  { name: SHEETS.rewards, headers: REWARD_COLUMNS, uniqueBy: ['Reward ID'] },
  { name: SHEETS.messages, headers: MESSAGE_COLUMNS, uniqueBy: ['Message ID'] },
] as const;

export const SHEET_DEFINITION_BY_NAME = new Map(
  SHEET_DEFINITIONS.map((definition) => [definition.name, definition]),
);

/** Primary-key column for each sheet — used for compare-and-swap guards. */
export const PRIMARY_KEY_COLUMN: Record<string, string> = {
  [SHEETS.users]: 'User ID',
  [SHEETS.customers]: 'Customer ID',
  [SHEETS.transactions]: 'Transaction ID',
  [SHEETS.payments]: 'Payment ID',
  [SHEETS.services]: 'Service ID',
  [SHEETS.auditLogs]: 'Log ID',
  [SHEETS.settings]: 'Key',
  [SHEETS.counters]: 'Name',
  [SHEETS.inventory]: 'Item ID',
  [SHEETS.stockMovements]: 'Movement ID',
  [SHEETS.expenses]: 'Expense ID',
  [SHEETS.shifts]: 'Shift ID',
  [SHEETS.cashMovements]: 'Movement ID',
  [SHEETS.machines]: 'Machine ID',
  [SHEETS.machineUsage]: 'Usage ID',
  [SHEETS.gasTanks]: 'Tank ID',
  [SHEETS.gasLogs]: 'Log ID',
  [SHEETS.loyalty]: 'Entry ID',
  [SHEETS.rewards]: 'Reward ID',
  [SHEETS.messages]: 'Message ID',
};
