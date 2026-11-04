import { useMutation } from '@tanstack/react-query';
import type { OrderStatus, PaymentMode } from '@shared/constants';
import { derivePickupStatus } from '@shared/calc';
import type { PaymentDto, TransactionDto } from '@shared/types';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { peso } from '@/lib/format';
import {
  applyTransactionUpdate,
  invalidateTransactionData,
  queryClient,
  removeFromUnpaidList,
} from '@/lib/queryClient';

interface StatusPayload {
  transactionId: string;
  orderStatus: OrderStatus;
  pickedUpBy?: string;
  acknowledgeBalance?: boolean;
}

/**
 * Shared transaction mutations. Centralised so the board, the pickup queue and
 * the detail page all behave identically — including the confirmation the
 * server demands before releasing an order that still owes money.
 */
export function useStatusMutation(options?: {
  onBalanceBlocked?: (transactionId: string, balance: number) => void;
}) {
  const toast = useToast();

  return useMutation({
    mutationFn: ({ transactionId, ...body }: StatusPayload) =>
      api.post<{ transaction: TransactionDto }>('/transactions/' + transactionId + '/status', body),

    /*
     * Move the card immediately rather than after the round trip.
     *
     * A status change is two Apps Script calls — several seconds — and staring
     * at an unchanged screen for that long feels broken. The change is applied
     * to the cache up front and rolled back if the server disagrees, so the
     * queue keeps up with the person using it.
     */
    onMutate: async ({ transactionId, orderStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['pickup'] });
      const previous = queryClient.getQueriesData({ queryKey: ['pickup'] });

      queryClient.setQueriesData<{ items: TransactionDto[] } | undefined>(
        { queryKey: ['pickup'] },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((item) =>
              item.transactionId === transactionId
                ? {
                    ...item,
                    orderStatus,
                    pickupStatus: derivePickupStatus(orderStatus),
                  }
                : item,
            ),
          };
        },
      );

      return { previous };
    },

    onSuccess: (result) => {
      // Apply the server's version to what is on screen first, then mark the
      // rest stale. Waiting on refetches here is what made a saved change take
      // a few seconds to appear.
      applyTransactionUpdate(result.transaction);
      invalidateTransactionData();
      toast.success(
        result.transaction.orNumber + ' moved to ' + result.transaction.orderStatus,
        result.transaction.customerName,
      );
    },

    onError: (error, variables, context) => {
      // Put the optimistic change back the way it was before reporting.
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (
        error instanceof ApiError &&
        error.code === 'CONFLICT' &&
        (error.details as { requiresAcknowledgement?: boolean } | undefined)
          ?.requiresAcknowledgement
      ) {
        const balance =
          (error.details as { balance?: number } | undefined)?.balance ?? 0;
        options?.onBalanceBlocked?.(variables.transactionId, balance);
        return;
      }
      toast.error('Unable to update status', errorMessage(error));
    },
  });
}

interface PaymentPayload {
  transactionId: string;
  /** One entry per method, so half cash and half GCash is a single settlement. */
  payments: Array<{ modeOfPayment: PaymentMode; amount: number; referenceNumber?: string }>;
  notes?: string;
  idempotencyKey: string;
}

interface PaymentResult {
  transaction: TransactionDto;
  payment: PaymentDto;
  payments: PaymentDto[];
  change: number;
}

export function usePaymentMutation(onSettled?: (transaction: TransactionDto) => void) {
  const toast = useToast();

  return useMutation({
    mutationFn: ({ transactionId, ...body }: PaymentPayload) =>
      api.post<PaymentResult>('/transactions/' + transactionId + '/payments', body),
    onSuccess: (result) => {
      applyTransactionUpdate(result.transaction);
      // A settled order leaves the "Not paid" list straight away rather than
      // lingering there showing a zero balance.
      if (result.transaction.balance <= 0) {
        removeFromUnpaidList(result.transaction.transactionId);
      }
      invalidateTransactionData();
      const applied = (result.payments ?? [result.payment]).reduce(
        (sum, entry) => sum + entry.amount,
        0,
      );
      toast.success(
        'Payment recorded \u00B7 ' + peso(applied),
        result.change > 0
          ? 'Change ' + peso(result.change)
          : result.transaction.balance > 0
            ? 'Balance ' + peso(result.transaction.balance)
            : 'Fully settled',
      );
      onSettled?.(result.transaction);
    },
    onError: (error) => {
      toast.error('Unable to record payment', errorMessage(error));
    },
  });
}

export function useCancelMutation(onDone?: () => void) {
  const toast = useToast();

  return useMutation({
    mutationFn: ({ transactionId, reason }: { transactionId: string; reason: string }) =>
      api.post<{ transaction: TransactionDto }>('/transactions/' + transactionId + '/cancel', {
        reason,
      }),
    onSuccess: (result) => {
      applyTransactionUpdate(result.transaction);
      invalidateTransactionData();
      toast.success(result.transaction.orNumber + ' cancelled', 'The record has been kept.');
      onDone?.();
    },
    onError: (error) => {
      toast.error('Unable to cancel transaction', errorMessage(error));
    },
  });
}
