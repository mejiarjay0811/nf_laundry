import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Cache policy for a spreadsheet backend.
 *
 * How the app keeps up with the sheet is worth stating plainly, because there
 * is no live connection to it. Nothing is pushed from Google; the app only
 * learns about a change when it asks. It asks:
 *
 *   - when a screen opens and its data is older than `staleTime`
 *   - immediately after this app writes something (see invalidateTransactionData)
 *   - when the window is focused again, having been left
 *   - when the network comes back
 *   - on a timer, for the screens that need it — the pickup queue polls
 *
 * Refetching on focus is the one that matters day to day: a second till, or
 * someone editing the spreadsheet directly, is picked up as soon as the cashier
 * returns to the app rather than being missed until the page is reloaded. It is
 * bounded by `staleTime`, so switching windows repeatedly does not hammer a
 * backend where every call costs a couple of seconds.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Mark everything a sale or payment can affect as needing a refresh.
 *
 * `refetchType: 'none'` on purpose. Refetching all of these at once meant the
 * screen sat waiting on several round trips before it showed the change that
 * had already been saved — the pause after pressing save. The queries are
 * marked stale instead, so each refreshes the next time it is actually looked
 * at, and the screen in front of the user is updated directly from the
 * server's response by `applyTransactionUpdate` below.
 */
export function invalidateTransactionData(): void {
  for (const key of ['transactions', 'board', 'dashboard', 'reports', 'customers']) {
    void queryClient.invalidateQueries({ queryKey: [key], refetchType: 'none' });
  }

  /*
   * These two do refetch straight away, because they are the badges on the
   * navigation and the queue everyone works from — a stale "3 waiting" is
   * worse than a moment's background fetch. They are small, and they refresh
   * behind the screen rather than blocking it.
   */
  void queryClient.invalidateQueries({ queryKey: ['pickup'] });
  void queryClient.invalidateQueries({ queryKey: ['counts'] });
}

interface TransactionLike {
  transactionId: string;
}

interface ListLike<T> {
  items: T[];
}

/**
 * Put a just-saved transaction straight into the lists already on screen.
 *
 * The server has told us exactly what the record now looks like, so there is
 * nothing to wait for. Anything holding an older copy of that row is patched
 * in place, which is what makes a payment or a status change appear the moment
 * it succeeds rather than a few seconds later.
 */
export function applyTransactionUpdate<T extends TransactionLike>(transaction: T): void {
  for (const key of ['transactions', 'pickup', 'board']) {
    queryClient.setQueriesData<ListLike<T> | undefined>({ queryKey: [key] }, (current) => {
      if (!current || !Array.isArray(current.items)) return current;
      let touched = false;
      const items = current.items.map((item) => {
        if (item.transactionId !== transaction.transactionId) return item;
        touched = true;
        // Keep fields the list added that the response does not carry, such as
        // the pickup queue's waiting-days count.
        return { ...item, ...transaction };
      });
      return touched ? { ...current, items } : current;
    });
  }

  // The single-record view, where a detail page may be open behind a dialog.
  queryClient.setQueryData(['transaction', transaction.transactionId], (current: unknown) => {
    if (!current || typeof current !== 'object') return current;
    const existing = current as { transaction?: unknown };
    if (!existing.transaction) return current;
    return { ...existing, transaction: { ...(existing.transaction as object), ...transaction } };
  });
}

/**
 * Drop a settled order from the "Not paid" list, which it no longer belongs to.
 *
 * Deliberately narrow: only that view. A paid order is still waiting on the
 * shelf, so removing it from the pickup queue as well would lose the order the
 * customer is standing there to collect.
 */
export function removeFromUnpaidList(transactionId: string): void {
  queryClient.setQueriesData<ListLike<TransactionLike> | undefined>(
    {
      queryKey: ['transactions'],
      predicate: (query) => {
        const params = query.queryKey[1] as { tab?: string } | undefined;
        return params?.tab === 'notpaid';
      },
    },
    (current) => {
      if (!current || !Array.isArray(current.items)) return current;
      const items = current.items.filter((item) => item.transactionId !== transactionId);
      return items.length === current.items.length ? current : { ...current, items };
    },
  );
}
