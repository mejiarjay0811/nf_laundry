import { useQuery } from '@tanstack/react-query';
import type { Paginated, TransactionDto } from '@shared/types';
import { api } from '@/lib/api';

interface PickupItem extends TransactionDto {
  waitingDays: number;
}

export interface OperationalCounts {
  /** Orders finished and waiting on the shelf. */
  readyForPickup: number;
  /** Orders that still owe money. */
  notPaid: number;
}

/**
 * The two numbers worth putting on the navigation.
 *
 * Both are things somebody has to act on: laundry waiting to be handed over,
 * and money not yet collected. They share the pickup query with the queue
 * screen, so opening that page costs nothing extra.
 *
 * The unpaid count asks for a single row and reads the total, because the
 * count is all that is wanted — there is no point pulling a page of records to
 * put one number in a badge.
 */
export function useOperationalCounts(): OperationalCounts {
  const pickup = useQuery({
    queryKey: ['pickup'],
    queryFn: ({ signal }) =>
      api.get<{ items: PickupItem[] }>('/transactions/pickup-queue', undefined, signal),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const unpaid = useQuery({
    queryKey: ['counts', 'unpaid'],
    queryFn: ({ signal }) =>
      api.get<Paginated<TransactionDto>>(
        '/transactions',
        { page: 1, pageSize: 1, outstanding: true },
        signal,
      ),
    staleTime: 60_000,
    refetchInterval: 180_000,
  });

  return {
    readyForPickup: (pickup.data?.items ?? []).filter(
      (item) => item.orderStatus === 'Ready for Pickup',
    ).length,
    notPaid: unpaid.data?.total ?? 0,
  };
}
