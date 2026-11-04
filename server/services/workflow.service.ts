import { LIMITS, ORDER_FLOW, SHEETS, type OrderStatus } from '../../shared/constants.js';
import { derivePickupStatus } from '../../shared/calc.js';
import { daysBetweenKeys, manilaDateKey, manilaIso } from '../../shared/datetime.js';
import { toCentavos } from '../../shared/money.js';
import type { SessionUser, TransactionDto } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import { normaliseText } from '../utils/ids.js';
import { recordAudit } from './audit.service.js';
import { refreshCustomerStatistics } from './customer.service.js';
import {
  findTransactionRecord,
  toTransactionDto,
  resolveRow,
  withTransactionLock,
  toTransactionRecord,
  transactionsTable,
} from './transaction.service.js';

export interface UpdateStatusInput {
  orderStatus: OrderStatus;
  pickedUpBy?: string;
  notes?: string;
  /** Explicit confirmation required to release an order that still owes money. */
  acknowledgeBalance?: boolean;
}

/**
 * Move an order through the laundry workflow.
 *
 * Order Status is the single source of truth; Pickup Status is written as a
 * projection of it so the two columns can never disagree in the workbook.
 */
export async function updateOrderStatus(
  transactionId: string,
  input: UpdateStatusInput,
  actor: SessionUser,
): Promise<TransactionDto> {
  if (!ORDER_FLOW.includes(input.orderStatus)) {
    throw badRequest('Use the cancel action to cancel a transaction.');
  }

  return withTransactionLock(transactionId, async () => {
    const store = getStore();
    const table = await transactionsTable(true);
    const row = resolveRow(table, transactionId);
    if (!row) throw notFound('Transaction');
    const record = toTransactionRecord(row);

    if (record.status === 'Cancelled') {
      throw conflict('This transaction has been cancelled.');
    }
    if (record.orderStatus === input.orderStatus) {
      return toTransactionDto(record);
    }

    const releasing = input.orderStatus === 'Picked Up';
    if (releasing && toCentavos(record.balance) > 0 && !input.acknowledgeBalance) {
      throw conflict(
        'This order still has an outstanding balance. Record the payment first, or confirm release with a balance.',
        { balance: record.balance, requiresAcknowledgement: true },
      );
    }

    const patch: Record<string, string> = {
      'Order Status': input.orderStatus,
      'Pickup Status': derivePickupStatus(input.orderStatus),
      'Updated By': actor.username,
    };

    if (releasing) {
      patch['Date Picked Up'] = manilaIso();
      patch['Picked Up By'] = normaliseText(input.pickedUpBy, 80) || record.customerName;
    } else if (record.orderStatus === 'Picked Up') {
      // Moving back out of "Picked Up" clears the release details.
      patch['Date Picked Up'] = '';
      patch['Picked Up By'] = '';
    }

    if (input.notes !== undefined) {
      patch.Notes = normaliseText(input.notes, LIMITS.maxNotesLength);
    }

    await store.updateRecord(SHEETS.transactions, row, patch);

    await recordAudit({
      actor,
      action: releasing ? 'PICKUP_UPDATE' : 'STATUS_UPDATE',
      module: releasing ? 'Pickup' : 'Transactions',
      entityId: record.transactionId,
      previousValue: { orderStatus: record.orderStatus },
      newValue: {
        orderStatus: input.orderStatus,
        pickedUpBy: patch['Picked Up By'] ?? '',
        releasedWithBalance: releasing && toCentavos(record.balance) > 0 ? record.balance : 0,
      },
    });

    const updated = await findTransactionRecord(transactionId);
    if (!updated) throw notFound('Transaction');
    return toTransactionDto(updated);
  });
}

/** Admin-only soft delete. The row is preserved; only its status changes. */
export async function cancelTransaction(
  transactionId: string,
  reason: string,
  actor: SessionUser,
): Promise<TransactionDto> {
  const trimmed = normaliseText(reason, 200);
  if (trimmed.length < 3) throw badRequest('Please give a reason for cancelling.');

  return withTransactionLock(transactionId, async () => {
    const store = getStore();
    const table = await transactionsTable(true);
    const row = resolveRow(table, transactionId);
    if (!row) throw notFound('Transaction');
    const record = toTransactionRecord(row);

    if (record.status === 'Cancelled') throw conflict('This transaction is already cancelled.');
    if (record.orderStatus === 'Picked Up') {
      throw conflict('This order has already been released. Refund it instead of cancelling.');
    }

    await store.updateRecord(SHEETS.transactions, row, {
      Status: 'Cancelled',
      'Order Status': 'Cancelled',
      'Pickup Status': 'Cancelled',
      'Payment Status': 'Cancelled',
      'Updated By': actor.username,
      Notes: normaliseText(
        (record.notes + ' | Cancelled: ' + trimmed).trim(),
        LIMITS.maxNotesLength,
      ),
    });

    await refreshCustomerStatistics(record.customerId).catch(() => undefined);
    await recordAudit({
      actor,
      action: 'TRANSACTION_CANCEL',
      module: 'Transactions',
      entityId: record.transactionId,
      previousValue: { status: record.status, orderStatus: record.orderStatus },
      newValue: { status: 'Cancelled', reason: trimmed },
    });

    const updated = await findTransactionRecord(transactionId);
    if (!updated) throw notFound('Transaction');
    return toTransactionDto(updated);
  });
}

/* ------------------------------------------------------------- pickup */

export interface PickupQueueItem extends TransactionDto {
  /** Days since the order became ready — drives the "waiting too long" alert. */
  waitingDays: number;
}

export async function getPickupQueue(options: { includePickedUp?: boolean } = {}): Promise<
  PickupQueueItem[]
> {
  const table = await transactionsTable();
  const today = manilaDateKey();

  return table.rows
    .map(toTransactionRecord)
    .map(toTransactionDto)
    .filter((item) => {
      if (item.status !== 'Active') return false;
      if (options.includePickedUp) return item.orderStatus !== 'Cancelled';
      return item.orderStatus !== 'Picked Up' && item.orderStatus !== 'Cancelled';
    })
    .map((item) => ({
      ...item,
      waitingDays:
        item.orderStatus === 'Ready for Pickup'
          ? Math.max(0, daysBetweenKeys(item.expectedPickup || item.transactionDate, today))
          : 0,
    }))
    .sort((a, b) => {
      const rank = (status: OrderStatus) => (status === 'Ready for Pickup' ? 0 : 1);
      if (rank(a.orderStatus) !== rank(b.orderStatus)) {
        return rank(a.orderStatus) - rank(b.orderStatus);
      }
      return b.waitingDays - a.waitingDays || a.transactionDate.localeCompare(b.transactionDate);
    });
}
