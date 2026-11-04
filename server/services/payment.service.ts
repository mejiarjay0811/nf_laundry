import {
  LIMITS,
  SHEETS,
  describePaymentModes,
  type PaymentMode,
} from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type { PaymentDto, SessionUser, TransactionDto } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { recordAudit } from './audit.service.js';
import { refreshCustomerStatistics } from './customer.service.js';
import { appendPaymentLedgerRow, voidPaymentLedgerRow } from './ledger.js';
import {
  assertChangeIsPayable,
  distributeApplied,
  normalisePaymentLines,
  tenderedTotalC,
} from './tender.js';
import {
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

export function toPaymentDto(row: RowView): PaymentDto {
  return {
    paymentId: row.get('Payment ID'),
    transactionId: row.get('Transaction ID'),
    orNumber: row.get('O.R. Number'),
    customerId: row.get('Customer ID'),
    amount: row.num('Amount'),
    modeOfPayment: (row.get('Mode of Payment') || 'Cash') as PaymentMode,
    paymentDate: row.get('Payment Date'),
    receivedBy: row.get('Received By'),
    referenceNumber: row.get('Reference Number'),
    notes: row.get('Notes'),
    status: row.get('Status') === 'Cancelled' ? 'Cancelled' : 'Active',
  };
}

export async function listPaymentsForTransaction(transactionId: string): Promise<PaymentDto[]> {
  const table = await getStore().table(SHEETS.payments);
  return table.rows
    .filter((row) => row.get('Transaction ID') === transactionId)
    .map(toPaymentDto)
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
}

export async function listPayments(from?: string, to?: string): Promise<PaymentDto[]> {
  const table = await getStore().table(SHEETS.payments);
  return table.rows
    .map(toPaymentDto)
    .filter((payment) => {
      if (payment.status !== 'Active') return false;
      const dateKey = payment.paymentDate.slice(0, 10);
      if (from && dateKey < from) return false;
      if (to && dateKey > to) return false;
      return true;
    })
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
}

export interface RecordPaymentInput {
  /** Single-method shorthand. Ignored when `payments` is supplied. */
  amount?: number;
  modeOfPayment?: PaymentMode;
  referenceNumber?: string;
  /** One entry per method, for a balance settled with more than one. */
  payments?: Array<{ modeOfPayment: PaymentMode; amount: number; referenceNumber?: string }>;
  notes?: string;
  idempotencyKey: string;
}

export interface RecordPaymentResult {
  transaction: TransactionDto;
  /** The first ledger row written, kept for callers that expect one payment. */
  payment: PaymentDto;
  /** Every ledger row written by this settlement — one per method. */
  payments: PaymentDto[];
  /** Cash handed back at the counter for this specific payment. */
  change: number;
  replayed: boolean;
}

/**
 * Apply a payment against an outstanding balance.
 *
 * Only the amount needed to settle the balance is applied; anything tendered
 * above that is returned as change rather than recorded as revenue, so a
 * mistyped amount can never inflate the day's sales.
 */
export async function recordPayment(
  transactionId: string,
  input: RecordPaymentInput,
  actor: SessionUser,
): Promise<RecordPaymentResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) {
    throw badRequest('Missing submission key. Please reload the page and try again.');
  }

  /*
   * A balance can be settled with more than one method — ₱100 cash and ₱75
   * GCash against a ₱175 bill is routine. The single-amount form is kept so
   * older callers keep working, and both end up as the same list of lines.
   */
  const lines = normalisePaymentLines(
    input.payments && input.payments.length > 0
      ? input.payments
      : input.amount !== undefined && input.modeOfPayment
        ? [
            {
              modeOfPayment: input.modeOfPayment,
              amount: input.amount,
              ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
            },
          ]
        : [],
  );

  if (lines.length === 0) throw badRequest('Enter a payment amount greater than zero.');

  const tenderedC = tenderedTotalC(lines);
  if (tenderedC <= 0) throw badRequest('Enter a payment amount greater than zero.');
  if (toPesos(tenderedC) > LIMITS.maxPaidAmount) {
    throw badRequest('Payment amount is out of range.');
  }

  return withTransactionLock(transactionId, async () => {
    const store = getStore();

    const payments = await store.table(SHEETS.payments, { fresh: true });
    const replayed = payments.rows.filter(
      (row) => row.get('Idempotency Key') === input.idempotencyKey,
    );
    if (replayed.length > 0) {
      const current = await findTransactionRecord(transactionId);
      if (!current) throw notFound('Transaction');
      const dtos = replayed.map(toPaymentDto);
      return {
        transaction: toTransactionDto(current),
        payment: dtos[0] as PaymentDto,
        payments: dtos,
        change: 0,
        replayed: true,
      };
    }

    const table = await transactionsTable(true);
    const row = resolveRow(table, transactionId);
    if (!row) throw notFound('Transaction');
    const record = toTransactionRecord(row);

    if (record.status === 'Cancelled') {
      throw conflict('This transaction has been cancelled and cannot take payments.');
    }
    if (record.paymentStatus === 'Refunded') {
      throw conflict('This transaction was refunded and cannot take payments.');
    }

    const balanceC = toCentavos(record.balance);
    if (balanceC <= 0) throw conflict('This transaction is already fully paid.');

    const appliedC = Math.min(tenderedC, balanceC);
    const changeC = tenderedC - appliedC;

    // Change comes out of the drawer, so an overpayment with no cash in it
    // cannot be settled at all.
    assertChangeIsPayable(lines, changeC);

    const money = recomputeMoneyFields({
      unitPrice: record.unitPrice,
      quantity: record.quantity,
      discount: record.discount,
      additionalCharge: record.additionalCharge,
      paidAmount: toPesos(toCentavos(record.paidAmount) + appliedC),
    });
    const paymentStatus = paymentStatusFor(money, false);

    /*
     * One ledger row per method, because the cash and GCash figures in every
     * report are summed from the ledger. Only money that settles the bill is
     * written; the overshoot is change, not revenue.
     */
    const distributed = distributeApplied(lines, appliedC).filter((line) => line.appliedC > 0);
    const written: PaymentDto[] = [];

    try {
      for (const line of distributed) {
        written.push(
          await appendPaymentLedgerRow({
            transactionId: record.transactionId,
            orNumber: record.orNumber,
            customerId: record.customerId,
            amountC: line.appliedC,
            mode: line.modeOfPayment,
            referenceNumber: normaliseText(line.referenceNumber, 40),
            receivedBy: actor.username,
            notes: normaliseText(input.notes, 200),
            idempotencyKey: input.idempotencyKey,
          }),
        );
      }
    } catch (error) {
      for (const entry of written) {
        await voidPaymentLedgerRow(
          entry.paymentId,
          'Voided automatically: the rest of the payment could not be recorded.',
        ).catch(() => undefined);
      }
      throw error;
    }

    /*
     * The transaction's method describes everything paid against it, not just
     * this settlement. Overwriting it with the latest method would erase the
     * cash from a bill that was half paid in cash and half in GCash.
     */
    const allModes = [
      ...payments.rows
        .filter(
          (candidate) =>
            candidate.get('Transaction ID') === record.transactionId &&
            candidate.get('Status') !== 'Cancelled',
        )
        .map((candidate) => (candidate.get('Mode of Payment') || 'Cash') as PaymentMode),
      ...distributed.map((line) => line.modeOfPayment),
    ];

    try {
      await store.updateRecord(SHEETS.transactions, row, {
        ...moneyPatch(money),
        'Payment Status': paymentStatus,
        'Mode of Payment': describePaymentModes(allModes),
        'Date Paid': paymentStatus === 'Paid' ? manilaIso() : record.datePaid ?? '',
        'Updated By': actor.username,
      });
    } catch (error) {
      for (const entry of written) {
        await voidPaymentLedgerRow(
          entry.paymentId,
          'Voided automatically: the transaction update failed.',
        ).catch(() => undefined);
      }
      throw error;
    }

    await refreshCustomerStatistics(record.customerId).catch((error) =>
      logger.error('Customer rollup refresh failed', errorMeta(error)),
    );

    await recordAudit({
      actor,
      action: 'PAYMENT_RECORD',
      module: 'Payments',
      entityId: record.transactionId,
      previousValue: { paidAmount: record.paidAmount, balance: record.balance },
      newValue: {
        applied: toPesos(appliedC),
        methods: distributed.map((line) => line.modeOfPayment + ' ' + toPesos(line.appliedC)),
        balance: toPesos(money.balance),
      },
    });

    const updated = await findTransactionRecord(transactionId);
    if (!updated) throw notFound('Transaction');

    return {
      transaction: toTransactionDto(updated),
      payment: written[0] as PaymentDto,
      payments: written,
      change: toPesos(changeC),
      replayed: false,
    };
  });
}

/** Admin-only: mark a transaction refunded and void its payment ledger rows. */
export async function refundTransaction(
  transactionId: string,
  reason: string,
  actor: SessionUser,
): Promise<TransactionDto> {
  if (!reason.trim()) throw badRequest('A reason is required for a refund.');

  return withTransactionLock(transactionId, async () => {
    const store = getStore();
    const table = await transactionsTable(true);
    const row = resolveRow(table, transactionId);
    if (!row) throw notFound('Transaction');
    const record = toTransactionRecord(row);

    if (record.paymentStatus === 'Refunded') throw conflict('This transaction is already refunded.');
    if (toCentavos(record.paidAmount) <= 0) throw conflict('There is no payment to refund.');

    await store.updateRecord(SHEETS.transactions, row, {
      'Payment Status': 'Refunded',
      'Updated By': actor.username,
      Notes: normaliseText(
        (record.notes + ' | Refunded: ' + reason).trim(),
        LIMITS.maxNotesLength,
      ),
    });

    const payments = await store.table(SHEETS.payments, { fresh: true });
    const related = payments.filter(
      (candidate) =>
        candidate.get('Transaction ID') === transactionId &&
        candidate.get('Status') !== 'Cancelled',
    );
    if (related.length > 0) {
      await store.updateRecords(
        SHEETS.payments,
        related.map((paymentRow) => ({
          row: paymentRow,
          patch: { Status: 'Cancelled', Notes: 'Refunded: ' + normaliseText(reason, 120) },
        })),
      );
    }

    await refreshCustomerStatistics(record.customerId).catch(() => undefined);
    await recordAudit({
      actor,
      action: 'PAYMENT_REFUND',
      module: 'Payments',
      entityId: record.transactionId,
      previousValue: { paymentStatus: record.paymentStatus, paidAmount: record.paidAmount },
      newValue: { paymentStatus: 'Refunded', reason },
    });

    const updated = await findTransactionRecord(transactionId);
    if (!updated) throw notFound('Transaction');
    return toTransactionDto(updated);
  });
}
