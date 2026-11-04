import type {
  AuditAction,
  AuditModule,
  CashMovementType,
  EntityStatus,
  GasLogType,
  GasTankStatus,
  LoyaltyType,
  MachineStatus,
  MachineType,
  MessageStatus,
  OrderStatus,
  PaymentMode,
  PaymentStatus,
  PickupStatus,
  RecordStatus,
  RewardType,
  Role,
  ShiftStatus,
} from './constants.js';

/**
 * Wire DTOs. Monetary fields are transported as PESO NUMBERS (2dp) so the
 * spreadsheet stays human-readable; the server converts to centavos at the
 * boundary and performs every calculation in integer centavos.
 */

export interface UserDto {
  userId: string;
  username: string;
  fullName: string;
  role: Role;
  status: EntityStatus;
  createdAt: string;
  lastLogin: string | null;
  updatedAt: string;
}

export interface SessionUser {
  userId: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface CustomerDto {
  customerId: string;
  fullName: string;
  address: string;
  contactNumber: string;
  registrationDate: string;
  totalTransactions: number;
  totalSpending: number;
  lastTransactionDate: string | null;
  status: EntityStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerStatsDto {
  totalTransactions: number;
  totalSpending: number;
  outstandingBalance: number;
  activeOrders: number;
  lastTransactionDate: string | null;
  favouriteService: string | null;
}

export interface ServiceDto {
  serviceId: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  status: EntityStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDto {
  transactionId: string;
  orNumber: string;
  customerId: string;
  customerName: string;
  contactNumber: string;
  serviceId: string;
  serviceType: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  additionalCharge: number;
  totalPayment: number;
  paidAmount: number;
  change: number;
  balance: number;
  paymentStatus: PaymentStatus;
  /** 'Cash', 'GCash', 'Cash + GCash', or empty when nothing has been paid. */
  modeOfPayment: string;
  orderStatus: OrderStatus;
  transactionDate: string;
  datePaid: string | null;
  pickupStatus: PickupStatus;
  datePickedUp: string | null;
  pickedUpBy: string;
  expectedPickup: string | null;
  timeStamp: string;
  createdBy: string;
  updatedBy: string;
  status: RecordStatus;
  notes: string;
}

export interface PaymentDto {
  paymentId: string;
  transactionId: string;
  orNumber: string;
  customerId: string;
  amount: number;
  modeOfPayment: PaymentMode;
  paymentDate: string;
  receivedBy: string;
  referenceNumber: string;
  notes: string;
  status: RecordStatus;
}

export interface AuditLogDto {
  logId: string;
  userId: string;
  username: string;
  action: AuditAction | string;
  module: AuditModule | string;
  entityId: string;
  previousValue: string;
  newValue: string;
  timestamp: string;
  sessionInfo: string;
}

export interface SettingsDto {
  [key: string]: string;
}

/* --------------------------------------------------------------- requests */

/** One method's share of a payment. A sale may settle with several. */
export interface PaymentLine {
  modeOfPayment: PaymentMode;
  amount: number;
  referenceNumber?: string;
}

export interface CreateTransactionRequest {
  /**
   * The O.R. number from the shop's BIR-issued receipt booklet, typed by the
   * cashier. Not generated: the authoritative number is the one printed on the
   * paper receipt, so the system records that rather than inventing its own.
   * Must be unique across all transactions.
   */
  orNumber: string;
  customerId?: string;
  newCustomer?: {
    fullName: string;
    address?: string;
    /** Optional — plenty of walk-ins do not leave a number. */
    contactNumber?: string;
    /** Set after the client has shown a same-name warning and been overridden. */
    allowDuplicateName?: boolean;
  };
  serviceId: string;
  quantity: number;
  discount?: number;
  additionalCharge?: number;
  /**
   * Money tendered, split by method. An empty array means an unpaid order.
   * Replaces the old single paidAmount/modeOfPayment pair.
   */
  payments?: PaymentLine[];
  notes?: string;
  expectedPickup?: string | null;
  /** Client-generated idempotency key; replays return the original result. */
  idempotencyKey: string;
}

export interface CreateTransactionResponse {
  transaction: TransactionDto;
  customer: CustomerDto;
  /** One entry per method used to settle the sale. */
  payments: PaymentDto[];
  /** Cash handed back across the counter, if the tender exceeded the bill. */
  change: number;
  replayed: boolean;
}

export interface RecordPaymentRequest {
  amount: number;
  modeOfPayment: PaymentMode;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey: string;
}

export interface UpdateStatusRequest {
  orderStatus: OrderStatus;
  pickedUpBy?: string;
  notes?: string;
}

export interface UpdateTransactionRequest {
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  additionalCharge?: number;
  notes?: string;
  expectedPickup?: string | null;
  reason: string;
}

/* -------------------------------------------------------------- responses */

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface DashboardMetrics {
  range: { from: string; to: string; label: string };
  sales: number;
  transactions: number;
  paidTransactions: number;
  unpaidTransactions: number;
  partiallyPaidTransactions: number;
  outstandingBalance: number;
  pendingLaundry: number;
  readyForPickup: number;
  pickedUpToday: number;
  customersServed: number;
  newCustomers: number;
  cashSales: number;
  gcashSales: number;
  discounts: number;
  additionalCharges: number;
  averageTransactionValue: number;
  previous: { sales: number; transactions: number };
  salesGrowthPct: number | null;
  trend: Array<{ dateKey: string; sales: number; transactions: number }>;
}

export interface SalesSummary {
  range: { from: string; to: string; label: string };
  totalSales: number;
  totalTransactions: number;
  cashSales: number;
  gcashSales: number;
  collectedAmount: number;
  outstandingBalance: number;
  discounts: number;
  additionalCharges: number;
  averageTransactionValue: number;
  customers: number;
  byService: Array<{ serviceType: string; transactions: number; quantity: number; sales: number }>;
  byPaymentStatus: Array<{ status: string; count: number; amount: number }>;
  byPickupStatus: Array<{ status: string; count: number }>;
  byPaymentMode: Array<{ mode: string; count: number; amount: number }>;
  topCustomers: Array<{
    customerId: string;
    customerName: string;
    transactions: number;
    spending: number;
  }>;
  daily: Array<{
    dateKey: string;
    sales: number;
    transactions: number;
    cash: number;
    gcash: number;
  }>;
}

export interface DailySummary extends SalesSummary {
  dateKey: string;
  readyForPickup: number;
  pickedUp: number;
  serviceCounts: Record<string, number>;
}

export interface WeeklySummary extends SalesSummary {
  weekStart: string;
  weekEnd: string;
  averageDailySales: number;
  bestDay: { dateKey: string; sales: number } | null;
}

export interface MonthlySummary extends SalesSummary {
  year: number;
  month: number;
  averageDailySales: number;
  bestDay: { dateKey: string; sales: number } | null;
}

export interface YearlySummary extends SalesSummary {
  year: number;
  monthly: Array<{ month: number; label: string; sales: number; transactions: number }>;
  bestMonth: { month: number; label: string; sales: number } | null;
  lowestMonth: { month: number; label: string; sales: number } | null;
  averageMonthlySales: number;
}

export interface AlertItem {
  id: string;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
  count: number;
  href?: string;
}

export interface GlobalSearchResult {
  customers: Array<Pick<CustomerDto, 'customerId' | 'fullName' | 'contactNumber'>>;
  transactions: Array<
    Pick<
      TransactionDto,
      'transactionId' | 'orNumber' | 'customerName' | 'totalPayment' | 'paymentStatus' | 'orderStatus' | 'transactionDate'
    >
  >;
}

export interface HealthStatus {
  ok: boolean;
  provider: string;
  spreadsheetId: string | null;
  sheetsReady: boolean;
  missingSheets: string[];
  latencyMs: number | null;
  message: string;
}

/* --------------------------------------------- inventory and expenses */

export interface InventoryItemDto {
  itemId: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  unitCost: number;
  reorderLevel: number;
  supplier: string;
  status: EntityStatus;
  notes: string;
  /** quantity x unitCost — what the shelf is worth. */
  stockValue: number;
  /** True when the quantity has fallen to or below the reorder level. */
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementDto {
  movementId: string;
  itemId: string;
  itemName: string;
  type: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  balanceAfter: number;
  expenseId: string;
  reason: string;
  recordedBy: string;
  movementDate: string;
}

export interface ExpenseDto {
  expenseId: string;
  expenseDate: string;
  category: string;
  description: string;
  amount: number;
  modeOfPayment: string;
  paidTo: string;
  reference: string;
  itemId: string;
  recordedBy: string;
  status: 'Active' | 'Cancelled';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** What the shop earned against what it spent, over a period. */
export interface ProfitSummaryDto {
  range: { from: string; to: string; label: string };
  sales: number;
  collected: number;
  expenses: number;
  /** collected - expenses. What is actually left. */
  net: number;
  expensesByCategory: Array<{ category: string; amount: number; share: number }>;
  transactionCount: number;
  expenseCount: number;
}

/* ------------------------------------------------- cash shifts */

export interface CashShiftDto {
  shiftId: string;
  userId: string;
  username: string;
  fullName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  countedCash: number | null;
  /** What the ledger says should be in the drawer. Derived, never stored blind. */
  expectedCash: number | null;
  /** counted - expected. Negative is short. */
  variance: number | null;
  status: ShiftStatus;
  openingNote: string;
  closingNote: string;
  closedBy: string;
}

export interface CashMovementDto {
  movementId: string;
  shiftId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  reference: string;
  recordedBy: string;
  movementDate: string;
}

/** What the drawer should hold right now, and how that figure was reached. */
export interface ShiftReconciliationDto {
  shift: CashShiftDto;
  openingFloat: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  salesCount: number;
  movements: CashMovementDto[];
}

/* ---------------------------------------------------- machines */

export interface MachineDto {
  machineId: string;
  name: string;
  type: MachineType;
  capacityKg: number;
  location: string;
  status: MachineStatus;
  cycleMinutes: number;
  totalCycles: number;
  lastServiceDate: string;
  notes: string;
  /** Set when the machine is mid-load, so the floor view can show what is in it. */
  currentUsage: MachineUsageDto | null;
}

export interface MachineUsageDto {
  usageId: string;
  machineId: string;
  machineName: string;
  machineType: MachineType;
  transactionId: string;
  orNumber: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  operator: string;
  notes: string;
}

/* --------------------------------------------------------- gas */

export interface GasTankDto {
  tankId: string;
  label: string;
  supplier: string;
  sizeKg: number;
  purchaseCost: number;
  purchaseDate: string;
  installedAt: string;
  emptiedAt: string;
  cyclesServed: number;
  /** Only meaningful once the tank is spent — before that it would flatter itself. */
  costPerCycle: number | null;
  expenseId: string;
  status: GasTankStatus;
  notes: string;
}

export interface GasLogDto {
  logId: string;
  tankId: string;
  tankLabel: string;
  type: GasLogType;
  machineId: string;
  cycles: number;
  estimatedKg: number;
  cost: number;
  recordedBy: string;
  logDate: string;
  notes: string;
}

export interface GasSummaryDto {
  activeTank: GasTankDto | null;
  /** Average across spent tanks — the only ones whose true yield is known. */
  averageCostPerCycle: number | null;
  averageCyclesPerTank: number | null;
  cyclesOnCurrentTank: number;
  estimatedCyclesRemaining: number | null;
  spendThisMonth: number;
  tanksInStock: number;
}

/* ----------------------------------------------------- loyalty */

export interface LoyaltyEntryDto {
  entryId: string;
  customerId: string;
  customerName: string;
  type: LoyaltyType;
  points: number;
  balanceAfter: number;
  transactionId: string;
  rewardId: string;
  reason: string;
  recordedBy: string;
  entryDate: string;
  expiresAt: string;
}

export interface RewardDto {
  rewardId: string;
  name: string;
  description: string;
  type: RewardType;
  pointsCost: number;
  discountAmount: number;
  serviceId: string;
  status: EntityStatus;
  sortOrder: number;
}

export interface LoyaltyBalanceDto {
  customerId: string;
  customerName: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  /** Rewards this balance can actually pay for right now. */
  affordable: RewardDto[];
}

/* --------------------------------------------------- messaging */

export interface MessageDto {
  messageId: string;
  channel: string;
  template: string;
  customerId: string;
  contactNumber: string;
  body: string;
  status: MessageStatus;
  transactionId: string;
  providerReference: string;
  error: string;
  attempts: number;
  queuedAt: string;
  sentAt: string;
  createdBy: string;
}

/* ------------------------------------------- customer tracking */

/**
 * What a customer sees on their tracking page. Deliberately thin: no running
 * total, no address, no contact number — the link travels on a printed receipt
 * and anyone holding it can open it.
 */
export interface TrackingDto {
  orNumber: string;
  customerName: string;
  serviceType: string;
  quantity: number;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  balance: number;
  total: number;
  transactionDate: string;
  expectedPickup: string;
  readyAt: string | null;
  pickedUpAt: string | null;
  loyaltyBalance: number | null;
  recent: Array<{
    orNumber: string;
    transactionDate: string;
    serviceType: string;
    orderStatus: OrderStatus;
  }>;
}