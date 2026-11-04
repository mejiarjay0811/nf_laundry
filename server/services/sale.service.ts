import {
  LIMITS,
  SETTINGS_KEYS,
  SHEETS,
  describePaymentModes,
} from '../../shared/constants.js';
import { can } from '../../shared/permissions.js';
import { addDaysToKey, manilaDateKey, manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type {
  CreateTransactionRequest,
  CreateTransactionResponse,
  CustomerDto,
  PaymentDto,
  SessionUser,
} from '../../shared/types.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseContact, normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { resolvePricing } from './catalog.service.js';
import {
  assertNotDuplicate,
  getCustomerRecord,
  refreshCustomerStatistics,
  toCustomerDto,
} from './customer.service.js';
import { listPaymentsForTransaction } from './payment.service.js';
import { allocateSaleIdentifiers } from './sequence.service.js';
import { distributeApplied, normalisePaymentLines } from './tender.js';
import { getBooleanSetting, getNumericSetting } from './settings.service.js';
import {
  findByIdempotencyKey,
  findTransactionRecord,
  moneyPatch,
  paymentStatusFor,
  recomputeMoneyFields,
  toTransactionDto,
  resolveRow,
  withTransactionLock,
  toTransactionRecord,
  transactionsTable,
} from './transaction.service.js';

/**
 * Guard rails on who may reduce a bill. Admins are unrestricted; staff are
 * limited by two settings so a shop can decide its own policy.
 */
async function assertAdjustmentAllowed(
  actor: SessionUser,
  discount: number,
  additionalCharge: number,
): Promise<void> {
  if (discount < 0 || additionalCharge < 0) {
    throw badRequest('Discounts and additional charges cannot be negative.');
  }
  if (discount > LIMITS.maxDiscount || additionalCharge > LIMITS.maxAdditionalCharge) {
    throw badRequest('Adjustment amount is out of range.');
  }
  // Whoever may edit an order may price it; the setting below is what bounds
  // the counter, and a manager is not the counter.
  if (can(actor.role, 'orders.edit') || discount === 0) return;

  const allowed = await getBooleanSetting(SETTINGS_KEYS.allowStaffDiscount, true);
  if (!allowed) {
    throw forbidden('Only an administrator can apply a discount.');
  }
  const cap = await getNumericSetting(SETTINGS_KEYS.maxStaffDiscount, 50);
  if (discount > cap) {
    throw forbidden('Discounts above the configured limit require an administrator.');
  }
}

interface ResolvedCustomer {
  /** True when the customer still has to be written as part of this sale. */
  isNew: boolean;
  customer: CustomerDto;
}

async function resolveCustomerForSale(
  request: CreateTransactionRequest,
): Promise<ResolvedCustomer> {
  if (request.customerId) {
    const existing = await getCustomerRecord(request.customerId);
    if (!existing) throw notFound('Customer');
    if (existing.status === 'Inactive') {
      throw badRequest('This customer is inactive. Reactivate them before creating a sale.');
    }
    return { isNew: false, customer: toCustomerDto(existing) };
  }

  if (!request.newCustomer) {
    throw badRequest('Select an existing customer or enter the details for a new one.');
  }

  const fullName = normaliseText(request.newCustomer.fullName, 80);
  const contactNumber = normaliseContact(request.newCustomer.contactNumber);
  const address = normaliseText(request.newCustomer.address, 160);

  if (fullName.length < 2) throw badRequest('Customer name is required.');

  // The contact number is optional - plenty of walk-ins do not leave one - but
  // a number that IS given has to be plausible, or it is worse than none.
  if (contactNumber && contactNumber.replace(/\D/g, '').length < 7) {
    throw badRequest('Please enter a valid contact number, or leave it blank.');
  }

  const table = await getStore().table(SHEETS.customers);
  assertNotDuplicate(table, fullName, contactNumber, request.newCustomer.allowDuplicateName);

  return {
    isNew: true,
    customer: {
      customerId: '',
      fullName,
      address,
      contactNumber,
      registrationDate: '',
      totalTransactions: 0,
      totalSpending: 0,
      lastTransactionDate: null,
      status: 'Active',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  };
}

async function defaultExpectedPickup(): Promise<string> {
  const hours = await getNumericSetting(SETTINGS_KEYS.defaultTurnaroundHours, 24);
  const days = Math.max(0, Math.ceil(hours / 24));
  return addDaysToKey(manilaDateKey(), days);
}

/**
 * Present a freshly written record as a RowView, so the response can be built
 * from the values just sent instead of re-reading the sheet.
 */
function rowViewFrom(record: Record<string, string>, rowNumber: number): RowView {
  return {
    rowNumber,
    values: [],
    get: (column: string) => record[column] ?? '',
    num: (column: string, fallback = 0) => {
      const raw = record[column];
      if (raw === undefined || raw === '') return fallback;
      const parsed = Number(String(raw).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  };
}

/**
 * The authoritative "Complete Transaction" flow.
 *
 * Every monetary figure is recomputed here from the catalogue price and the
 * quantity - the client's totals are display-only and are never trusted.
 *
 * Shaped for a high-latency gateway: the whole sale costs THREE round trips
 * (refresh, allocate, append) rather than one per step. Against Apps Script a
 * call is ~2.5s, and a step-by-step flow made a sale take half a minute at the
 * counter. The rollup refresh and the audit entry run after the response, since
 * both are best-effort by design and neither changes what the cashier is told.
 */
export async function createTransaction(
  request: CreateTransactionRequest,
  actor: SessionUser,
  context: { ip?: string } = {},
): Promise<CreateTransactionResponse> {
  if (!request.idempotencyKey || request.idempotencyKey.length < 8) {
    throw badRequest('Missing submission key. Please reload the page and try again.');
  }

  return withNamedLock('transactions:create', async () => {
    const store = getStore();

    // --- Round trip 1: everything the pre-checks need, in one read --------
    // Services and Settings ride along even though they change rarely: it
    // costs nothing extra, and a price change then takes effect on the very
    // next sale rather than whenever the cache happens to expire.
    await store.refreshTables([
      SHEETS.transactions,
      SHEETS.customers,
      SHEETS.payments,
      SHEETS.services,
      SHEETS.settings,
    ]);

    // Replay protection - a double click or a retried request returns the
    // original sale instead of creating a second one. The refresh above is
    // this request's fresh read, so this must not force another.
    const replay = await findByIdempotencyKey(request.idempotencyKey, { fresh: false });
    if (replay) {
      logger.info('Idempotent replay of transaction create', {
        transactionId: replay.transactionId,
      });
      const existing = await getCustomerRecord(replay.customerId);
      return {
        transaction: toTransactionDto(replay),
        customer: existing ? toCustomerDto(existing) : ({} as CustomerDto),
        payments: await listPaymentsForTransaction(replay.transactionId),
        change: replay.change,
        replayed: true,
      };
    }

    // --- The O.R. number comes off the BIR booklet, typed by the cashier ---
    // Checked against the table refreshed a moment ago, and the whole create
    // flow holds a lock, so two cashiers cannot slip the same number through.
    const orNumber = normaliseText(request.orNumber, 30).toUpperCase();
    if (!orNumber) {
      throw badRequest('Enter the O.R. number from the receipt.');
    }
    const orTable = await store.table(SHEETS.transactions);
    const orClash = orTable.find(
      (row) => row.get('O.R. Number').trim().toUpperCase() === orNumber,
    );
    if (orClash) {
      throw conflict(
        'O.R. ' + orNumber + ' was already used on ' + orClash.get('Transaction Date') +
          ' for ' + orClash.get('Customer Name') + '.',
        { orNumber, transactionId: orClash.get('Transaction ID'), reason: 'or-number' },
      );
    }

    // --- Validate the inputs that money depends on ------------------------
    const quantity = Math.trunc(request.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > LIMITS.maxQuantity) {
      throw badRequest('Quantity must be a whole number between 1 and ' + LIMITS.maxQuantity + '.');
    }

    const discount = request.discount ?? 0;
    const additionalCharge = request.additionalCharge ?? 0;
    await assertAdjustmentAllowed(actor, discount, additionalCharge);

    // --- Tender, possibly split across methods ----------------------------
    const lines = normalisePaymentLines(request.payments ?? []);
    const tenderedC = lines.reduce((sum, line) => sum + toCentavos(line.amount), 0);
    if (toPesos(tenderedC) > LIMITS.maxPaidAmount) {
      throw badRequest('Paid amount is out of range.');
    }

    // --- Server-side pricing and arithmetic -------------------------------
    const pricing = await resolvePricing(request.serviceId);
    const money = recomputeMoneyFields({
      unitPrice: toPesos(pricing.unitPriceC),
      quantity,
      discount,
      additionalCharge,
      paidAmount: toPesos(tenderedC),
    });
    const paymentStatus = paymentStatusFor(money, false);

    // Change comes out of the LAST method tendered, which in practice is the
    // cash drawer - you cannot hand back GCash. If the only tender was GCash
    // and it overshot, that is a mistake worth refusing rather than silently
    // recording a cash refund that never happened.
    if (money.change > 0 && !lines.some((line) => line.modeOfPayment === 'Cash')) {
      throw badRequest(
        'This payment is more than the amount due, but there is no cash to give change from. ' +
          'Check the amount entered.',
      );
    }

    // --- Resolve the customer (an existing row, or one to be written) -----
    const resolved = await resolveCustomerForSale(request);

    // --- Round trip 2: every identifier, in one atomic call ---------------
    const ids = await allocateSaleIdentifiers({
      needCustomerId: resolved.isNew,
      paymentCount: lines.length,
    });

    const customerId = resolved.isNew ? (ids.customerId as string) : resolved.customer.customerId;
    const timestamp = manilaIso();
    const transactionDate = manilaDateKey();
    const expectedPickup = request.expectedPickup || (await defaultExpectedPickup());

    const customer: CustomerDto = resolved.isNew
      ? {
          ...resolved.customer,
          customerId,
          registrationDate: transactionDate,
          totalTransactions: 1,
          totalSpending: toPesos(money.total),
          lastTransactionDate: transactionDate,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : resolved.customer;

    // --- Build every row before writing anything --------------------------
    const batch: Array<{ sheet: string; records: Array<Record<string, string>> }> = [];

    if (resolved.isNew) {
      batch.push({
        sheet: SHEETS.customers,
        records: [
          {
            'Customer ID': customerId,
            'Full Name': customer.fullName,
            Address: customer.address,
            'Contact Number': customer.contactNumber,
            'Registration Date': transactionDate,
            'Total Transactions': '1',
            'Total Spending': toPesos(money.total).toFixed(2),
            'Last Transaction Date': transactionDate,
            Status: 'Active',
            Notes: '',
            'Created At': timestamp,
            'Updated At': timestamp,
          },
        ],
      });
    }

    /*
     * Each method becomes its own ledger row, because cash and GCash reporting
     * reads the ledger. Only money that settles the bill is recorded - any
     * overshoot is change, not revenue - so the applied total is distributed
     * across the lines in the order they were tendered.
     */
    const applied = distributeApplied(lines, money.appliedAmount);
    const payments: PaymentDto[] = applied.map((line, index) => ({
      paymentId: (ids.paymentIds[index] as string),
      transactionId: ids.transactionId,
      orNumber: orNumber,
      customerId,
      amount: toPesos(line.appliedC),
      modeOfPayment: line.modeOfPayment,
      paymentDate: timestamp,
      receivedBy: actor.username,
      referenceNumber: normaliseText(line.referenceNumber, 40),
      notes: '',
      status: 'Active',
    }));

    if (payments.length > 0) {
      batch.push({
        sheet: SHEETS.payments,
        records: payments.map((payment) => ({
          'Payment ID': payment.paymentId,
          'Transaction ID': payment.transactionId,
          'O.R. Number': payment.orNumber,
          'Customer ID': payment.customerId,
          Amount: payment.amount.toFixed(2),
          'Mode of Payment': payment.modeOfPayment,
          'Payment Date': payment.paymentDate,
          'Received By': payment.receivedBy,
          'Reference Number': payment.referenceNumber,
          Notes: '',
          Status: 'Active',
          'Idempotency Key': request.idempotencyKey,
        })),
      });
    }

    batch.push({
      sheet: SHEETS.transactions,
      records: [
        {
          'Transaction ID': ids.transactionId,
          'O.R. Number': orNumber,
          'Customer ID': customerId,
          'Customer Name': customer.fullName,
          'Contact Number': customer.contactNumber,
          'Service ID': pricing.serviceId,
          'Service Type': pricing.name,
          Quantity: String(quantity),
          'Unit Price': toPesos(pricing.unitPriceC).toFixed(2),
          ...moneyPatch(money),
          'Payment Status': paymentStatus,
          'Mode of Payment': describePaymentModes(lines.map((line) => line.modeOfPayment)),
          'Order Status': 'Received',
          'Transaction Date': transactionDate,
          'Date Paid': paymentStatus === 'Paid' ? timestamp : '',
          'Pickup Status': 'Pending',
          'Date Picked Up': '',
          'Picked Up By': '',
          'Expected Pickup': expectedPickup,
          'Time Stamp': timestamp,
          'Created By': actor.username,
          'Updated By': actor.username,
          Status: 'Active',
          Notes: normaliseText(request.notes, LIMITS.maxNotesLength),
          'Idempotency Key': request.idempotencyKey,
        },
      ],
    });

    // --- Round trip 3: all rows written together, under one lock ----------
    // Either every row lands or none does, so a sale is never half-saved.
    const results = await store.appendRecordsMany(batch);

    const written = results.find((entry) => entry.sheet === SHEETS.transactions);
    if (!written || written.startRow <= 0 || written.rowCount !== 1) {
      throw new AppError(
        'DATA_SOURCE_ERROR',
        'The transaction could not be confirmed as saved. Please check the transaction list before submitting again.',
      );
    }

    // The response is built from the row just written rather than by reading
    // the sheet back. The gateway already confirmed the write (it appended and
    // flushed under a lock, and returned the row number), so a re-read would
    // add a full round trip to learn what we already know.
    const writtenRow = batch[batch.length - 1]?.records[0] as Record<string, string>;
    const transaction = toTransactionDto(toTransactionRecord(rowViewFrom(writtenRow, written.startRow)));

    // --- After the sale: rollups and audit, off the critical path ---------
    void refreshCustomerStatistics(customerId).catch((error) =>
      logger.error('Customer rollup refresh failed', { customerId, ...errorMeta(error) }),
    );

    void recordAudit({
      actor,
      action: 'TRANSACTION_CREATE',
      module: 'Transactions',
      entityId: ids.transactionId,
      newValue: {
        orNumber: orNumber,
        customer: customer.fullName,
        service: pricing.name,
        quantity,
        total: toPesos(money.total),
        tendered: toPesos(tenderedC),
        methods: payments.map((p) => p.modeOfPayment + ' ' + p.amount.toFixed(2)),
      },
      sessionInfo: context.ip ?? '',
    });

    return {
      transaction,
      customer,
      payments,
      change: toPesos(money.change),
      replayed: false,
    };
  });
}

export interface UpdateTransactionInput {
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  additionalCharge?: number;
  notes?: string;
  expectedPickup?: string | null;
  reason: string;
}

/**
 * Correct an existing transaction.
 *
 * The identity of the sale is immutable — Transaction ID, O.R. Number, the
 * customer and the service all stay as they were. Only quantity, price and
 * adjustments can change, and every change is recorded with its reason.
 */
export async function updateTransaction(
  transactionId: string,
  input: UpdateTransactionInput,
  actor: SessionUser,
) {
  const reason = normaliseText(input.reason, 200);
  if (reason.length < 3) throw badRequest('Please give a reason for this correction.');

  return withTransactionLock(transactionId, async () => {
    const store = getStore();
    const table = await transactionsTable(true);
    const row = resolveRow(table, transactionId);
    if (!row) throw notFound('Transaction');
    const record = toTransactionRecord(row);

    if (record.status === 'Cancelled') {
      throw badRequest('A cancelled transaction cannot be edited.');
    }

    // A settled or released sale is a "major edit" and needs an administrator.
    const isMajor =
      record.paymentStatus !== 'Unpaid' ||
      record.orderStatus === 'Picked Up' ||
      input.unitPrice !== undefined;
    if (isMajor && !can(actor.role, 'orders.edit')) {
      throw forbidden('Only a manager or administrator can edit a paid or completed transaction.');
    }

    const quantity = input.quantity === undefined ? record.quantity : Math.trunc(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > LIMITS.maxQuantity) {
      throw badRequest('Quantity must be a whole number between 1 and ' + LIMITS.maxQuantity + '.');
    }

    // The historical unit price is preserved unless an admin deliberately
    // overrides it — a later price change in Services never rewrites history.
    const unitPrice = input.unitPrice === undefined ? record.unitPrice : input.unitPrice;
    if (!(unitPrice > 0) || unitPrice > LIMITS.maxUnitPrice) {
      throw badRequest('Unit price must be greater than zero.');
    }

    const discount = input.discount === undefined ? record.discount : input.discount;
    const additionalCharge =
      input.additionalCharge === undefined ? record.additionalCharge : input.additionalCharge;
    await assertAdjustmentAllowed(actor, discount, additionalCharge);

    const money = recomputeMoneyFields({
      unitPrice,
      quantity,
      discount,
      additionalCharge,
      paidAmount: record.paidAmount,
    });
    const paymentStatus = paymentStatusFor(money, false, record.paymentStatus === 'Refunded');

    const patch: Record<string, string> = {
      Quantity: String(quantity),
      'Unit Price': toPesos(toCentavos(unitPrice)).toFixed(2),
      ...moneyPatch(money),
      'Payment Status': paymentStatus,
      'Updated By': actor.username,
    };
    if (input.notes !== undefined) patch.Notes = normaliseText(input.notes, LIMITS.maxNotesLength);
    if (input.expectedPickup !== undefined) patch['Expected Pickup'] = input.expectedPickup ?? '';

    await store.updateRecord(SHEETS.transactions, row, patch);

    await refreshCustomerStatistics(record.customerId).catch((error) =>
      logger.error('Customer rollup refresh failed', errorMeta(error)),
    );

    await recordAudit({
      actor,
      action: 'TRANSACTION_UPDATE',
      module: 'Transactions',
      entityId: record.transactionId,
      previousValue: {
        quantity: record.quantity,
        unitPrice: record.unitPrice,
        discount: record.discount,
        additionalCharge: record.additionalCharge,
        total: record.totalPayment,
      },
      newValue: {
        quantity,
        unitPrice,
        discount,
        additionalCharge,
        total: toPesos(money.total),
        reason,
      },
    });

    const updated = await findTransactionRecord(transactionId);
    if (!updated) throw notFound('Transaction');
    return toTransactionDto(updated);
  });
}
