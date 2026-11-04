import { useEffect } from 'react';
import type { ServiceDto, TransactionDto } from '@shared/types';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';

/**
 * Fetches the handful of things every shift needs, once, in the background.
 *
 * Each screen otherwise pays its own two-to-four second round trip the first
 * time it is opened, which is exactly when someone is standing at the counter
 * waiting. These are fetched while the first screen is being read instead, so
 * opening the till or the queue is instant rather than a wait.
 *
 * Deliberately only the small, shared reads: the service price list, the
 * customer directory the till searches against, and the pickup queue that
 * drives the navigation badge. Warming everything would just move the cost.
 */
export function useWarmCache(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    // Let the current screen finish its own fetching first — warming should
    // never make the page someone is actually looking at slower.
    const timer = window.setTimeout(() => {
      void queryClient.prefetchQuery({
        queryKey: ['services'],
        queryFn: ({ signal }) => api.get<{ items: ServiceDto[] }>('/services', undefined, signal),
        staleTime: 5 * 60_000,
      });

      void queryClient.prefetchQuery({
        queryKey: ['customers', 'directory'],
        queryFn: ({ signal }) =>
          api.get('/customers', { page: 1, pageSize: 200, sortBy: 'name' }, signal),
        staleTime: 5 * 60_000,
      });

      void queryClient.prefetchQuery({
        queryKey: ['pickup'],
        queryFn: ({ signal }) =>
          api.get<{ items: TransactionDto[] }>('/transactions/pickup-queue', undefined, signal),
        staleTime: 30_000,
      });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [enabled]);
}
