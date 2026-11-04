import { COUNTER_KEYS, SHEETS } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { toPesos, type Centavos } from '../../shared/money.js';
import type { PaymentDto } from '../../shared/types.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import { nextEntityId } from './sequence.service.js';

export interface LedgerEntryInput {
  transactionId: string;
  orNumber: string;
  customerId: string;
  amountC: Centavos;
  mode: string;
  referenceNumber: string;
  receivedBy: string;
  notes: string;
  idempotencyKey: string;
}

/**
 * Append one row to the Payments ledger.
 *
 * Callers write the ledger row BEFORE mutating the transaction. If the
 * transaction write then fails, the worst outcome is an orphan ledger row —
 * which every report ignores, because reports are computed from Transactions —
 * rather than money that was taken but never recorded.
 */
export async function appendPaymentLedgerRow(input: LedgerEntryInput): Promise<PaymentDto> {
  const store = getStore();
  const paymentId = await nextEntityId(
    COUNTER_KEYS.paymentId,
    'PAY-',
    SHEETS.payments,
    'Payment ID',
    6,
  );
  const paymentDate = manilaIso();

  await store.appendRecords(SHEETS.payments, [
    {
      'Payment ID': paymentId,
      'Transaction ID': input.transactionId,
      'O.R. Number': input.orNumber,
      'Customer ID': input.customerId,
      Amount: toPesos(input.amountC).toFixed(2),
      'Mode of Payment': input.mode,
      'Payment Date': paymentDate,
      'Received By': input.receivedBy,
      'Reference Number': input.referenceNumber,
      Notes: input.notes,
      Status: 'Active',
      'Idempotency Key': input.idempotencyKey,
    },
  ]);

  return {
    paymentId,
    transactionId: input.transactionId,
    orNumber: input.orNumber,
    customerId: input.customerId,
    amount: toPesos(input.amountC),
    modeOfPayment: input.mode as PaymentDto['modeOfPayment'],
    paymentDate,
    receivedBy: input.receivedBy,
    referenceNumber: input.referenceNumber,
    notes: input.notes,
    status: 'Active',
  };
}

/** Compensating action: mark a ledger row cancelled after a failed write. */
export async function voidPaymentLedgerRow(paymentId: string, reason: string): Promise<void> {
  try {
    const store = getStore();
    const table = await store.table(SHEETS.payments, { fresh: true });
    const row = table.find((candidate) => candidate.get('Payment ID') === paymentId);
    if (!row) return;
    await store.updateRecord(SHEETS.payments, row, { Status: 'Cancelled', Notes: reason });
  } catch (error) {
    logger.error('Failed to void payment ledger row', { paymentId, ...errorMeta(error) });
  }
}
