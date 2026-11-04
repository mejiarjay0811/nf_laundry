import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  PackageCheck,
  Printer,
  Search,
} from 'lucide-react';
import { formatShortDate } from '@shared/datetime';
import type { TransactionDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { PaymentDialog } from '@/components/PaymentDialog';
import { ReceiptModal } from '@/components/ReceiptModal';
import { OrderBadge, PaymentBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { useStatusMutation } from '@/hooks/useTransactionActions';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso, pluralise } from '@/lib/format';

interface PickupItem extends TransactionDto {
  waitingDays: number;
}

type QueueView = 'all' | 'ready' | 'progress';

export default function Pickup() {
  useDocumentTitle('Pickup Queue');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<QueueView>('all');
  const [owedOnly, setOwedOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [payTarget, setPayTarget] = useState<TransactionDto | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<TransactionDto | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    transaction: TransactionDto;
    orderStatus: 'Ready for Pickup' | 'Picked Up';
  } | null>(null);
  const [releasePrompt, setReleasePrompt] = useState<{
    transaction: TransactionDto;
    balance: number;
  } | null>(null);

  const query = useQuery({
    queryKey: ['pickup'],
    queryFn: ({ signal }) =>
      api.get<{ items: PickupItem[] }>('/transactions/pickup-queue', undefined, signal),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const statusMutation = useStatusMutation({
    onBalanceBlocked: (transactionId, balance) => {
      const transaction = query.data?.items.find(
        (item) => item.transactionId === transactionId,
      );
      if (transaction) setReleasePrompt({ transaction, balance });
    },
  });

  const items = query.data?.items ?? [];

  /*
   * Filtering happens here rather than on the server: the whole queue is
   * already loaded, so narrowing it is instant instead of another round trip.
   */
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');

    return items.filter((item) => {
      if (view === 'ready' && item.orderStatus !== 'Ready for Pickup') return false;
      if (view === 'progress' && item.orderStatus === 'Ready for Pickup') return false;
      if (owedOnly && !(item.balance > 0)) return false;
      if (overdueOnly && !(item.orderStatus === 'Ready for Pickup' && item.waitingDays > 2)) {
        return false;
      }
      if (!needle) return true;

      const haystack = [item.orNumber, item.customerName, item.serviceType]
        .join(' ')
        .toLowerCase();
      const contactMatch =
        digits.length >= 3 && item.contactNumber.replace(/\D/g, '').includes(digits);
      return haystack.includes(needle) || contactMatch;
    });
  }, [items, search, view, owedOnly, overdueOnly]);

  const ready = filtered.filter((item) => item.orderStatus === 'Ready for Pickup');
  const inProgress = filtered.filter((item) => item.orderStatus !== 'Ready for Pickup');
  const overdue = items.filter(
    (item) => item.orderStatus === 'Ready for Pickup' && item.waitingDays > 2,
  );
  const owedCount = items.filter((item) => item.balance > 0).length;
  const filtersActive = Boolean(search.trim()) || view !== 'all' || owedOnly || overdueOnly;

  /*
   * Both moves are confirmed before they happen. Marking an order collected is
   * the shop saying the customer has walked out with their laundry, and these
   * buttons sit next to each other on a card that is easy to catch by accident
   * on a phone.
   */
  const markReady = (transaction: TransactionDto) =>
    setPendingMove({ transaction, orderStatus: 'Ready for Pickup' });

  const markPickedUp = (transaction: TransactionDto) =>
    setPendingMove({ transaction, orderStatus: 'Picked Up' });

  const renderCard = (item: PickupItem) => {
    const isReady = item.orderStatus === 'Ready for Pickup';
    const late = isReady && item.waitingDays > 2;

    return (
      <article
        key={item.transactionId}
        className={cn(
          'rounded-xl border bg-white p-4 shadow-card',
          late ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={'/transactions/' + item.transactionId}
              className="font-mono text-xs font-semibold text-brand-700 hover:underline"
            >
              {item.orNumber}
            </Link>
            <p className="mt-0.5 truncate font-medium text-navy-900">{item.customerName}</p>
            {item.contactNumber ? (
              <a
                href={'tel:' + item.contactNumber}
                className="text-sm text-slate-600 hover:text-brand-700 tnum"
              >
                {item.contactNumber}
              </a>
            ) : (
              <span className="text-sm text-slate-400">No contact number</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <OrderBadge status={item.orderStatus} />
            <PaymentBadge status={item.paymentStatus} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-600">
            {item.serviceType} {'\u00D7'} {item.quantity}
          </p>
          <p className="text-base font-bold text-navy-900 tnum">{peso(item.totalPayment)}</p>
        </div>

        {item.balance > 0 ? (
          <p className="mt-1 text-sm font-medium text-red-600 tnum">
            Balance due {peso(item.balance)}
          </p>
        ) : null}

        <p className="mt-1 text-xs text-slate-500 tnum">
          Received {formatShortDate(item.transactionDate)}
          {item.expectedPickup ? ' \u00B7 ready by ' + formatShortDate(item.expectedPickup) : ''}
        </p>

        {late ? (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Waiting {item.waitingDays} {pluralise(item.waitingDays, 'day')} for collection
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {!isReady ? (
            <Button
              size="sm"
              variant="outline"
              disabled={statusMutation.isPending}
              onClick={() => markReady(item)}
              icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            >
              Mark ready
            </Button>
          ) : (
            <Button
              size="sm"
              variant="success"
              disabled={statusMutation.isPending}
              onClick={() => markPickedUp(item)}
              icon={<PackageCheck className="h-4 w-4" aria-hidden="true" />}
            >
              Mark picked up
            </Button>
          )}

          {item.balance > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPayTarget(item)}
              icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
            >
              Record payment
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReceiptTarget(item)}
            icon={<Printer className="h-4 w-4" aria-hidden="true" />}
          >
            Receipt
          </Button>
        </div>
      </article>
    );
  };

  return (
    <>
      <PageHeader
        title="Pickup Queue"
        subtitle={
          items.filter((item) => item.orderStatus === 'Ready for Pickup').length +
          ' ready \u00B7 ' +
          items.filter((item) => item.orderStatus !== 'Ready for Pickup').length +
          ' still being processed' +
          (filtersActive ? ' \u00B7 showing ' + filtered.length : '')
        }
      />

      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, O.R. number or contact"
              aria-label="Search the pickup queue"
              className="h-11 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>

          <div
            role="group"
            aria-label="Show"
            className="flex shrink-0 rounded-lg border border-slate-300 p-0.5"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'ready', label: 'Ready' },
                { id: 'progress', label: 'In shop' },
              ] as Array<{ id: QueueView; label: string }>
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className={cn(
                  'flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none',
                  view === option.id
                    ? 'bg-navy-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={owedOnly}
            onClick={() => setOwedOnly((value) => !value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              owedOnly
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            Owes money{owedCount > 0 ? ' (' + owedCount + ')' : ''}
          </button>
          <button
            type="button"
            aria-pressed={overdueOnly}
            onClick={() => setOverdueOnly((value) => !value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              overdueOnly
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            Waiting over 2 days{overdue.length > 0 ? ' (' + overdue.length + ')' : ''}
          </button>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setView('all');
                setOwedOnly(false);
                setOverdueOnly(false);
              }}
              className="rounded-full px-3 py-1 text-xs font-medium text-slate-500 hover:text-navy-800"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {overdue.length > 0 && !overdueOnly ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm text-amber-900">
            <strong>{overdue.length}</strong>{' '}
            {pluralise(overdue.length, 'order has', 'orders have')} been waiting more than two
            days. Consider following up with the customer.
          </p>
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="card">
          <SkeletonTable rows={5} columns={4} />
        </div>
      ) : query.isError ? (
        <div className="card">
          <ErrorState
            title="Unable to load the pickup queue"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" aria-hidden="true" />}
            title={filtersActive ? 'Nothing matches those filters.' : 'No orders are ready for pickup.'}
            message={
              filtersActive
                ? 'Try a different search, or clear the filters.'
                : 'Everything has been collected. New orders will appear here as they progress.'
            }
            action={
              filtersActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setView('all');
                    setOwedOnly(false);
                    setOverdueOnly(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
              Ready for pickup
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 tnum">
                {ready.length}
              </span>
            </h2>
            {ready.length === 0 ? (
              <p className="card px-4 py-6 text-center text-sm text-slate-500">
                Nothing is waiting on the shelf right now.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {ready.map(renderCard)}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
              Still in progress
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 tnum">
                {inProgress.length}
              </span>
            </h2>
            {inProgress.length === 0 ? (
              <p className="card px-4 py-6 text-center text-sm text-slate-500">
                Nothing is being processed.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {inProgress.map(renderCard)}
              </div>
            )}
          </section>
        </div>
      )}

      <PaymentDialog
        transaction={payTarget}
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        onSettled={() => void query.refetch()}
      />

      <ReceiptModal
        transaction={receiptTarget}
        open={receiptTarget !== null}
        onClose={() => setReceiptTarget(null)}
        title="Reprint receipt"
      />

      <ConfirmDialog
        open={pendingMove !== null}
        onClose={() => setPendingMove(null)}
        busy={statusMutation.isPending}
        title={
          pendingMove?.orderStatus === 'Picked Up'
            ? 'Mark this order collected?'
            : 'Mark this order ready?'
        }
        confirmLabel={pendingMove?.orderStatus === 'Picked Up' ? 'Yes, collected' : 'Yes, ready'}
        message={
          pendingMove ? (
            <>
              <strong>{pendingMove.transaction.orNumber}</strong> {'·'}{' '}
              {pendingMove.transaction.customerName}
              <br />
              {pendingMove.orderStatus === 'Picked Up'
                ? 'This records that the customer has taken their laundry.'
                : 'This tells the counter the laundry is done and waiting on the shelf.'}
              {pendingMove.transaction.balance > 0 ? (
                <span className="mt-2 block font-medium text-red-600">
                  Still owes {peso(pendingMove.transaction.balance)}.
                </span>
              ) : null}
            </>
          ) : null
        }
        onConfirm={() => {
          if (!pendingMove) return;
          statusMutation.mutate(
            {
              transactionId: pendingMove.transaction.transactionId,
              orderStatus: pendingMove.orderStatus,
            },
            { onSettled: () => setPendingMove(null) },
          );
        }}
      />

      <ConfirmDialog
        open={releasePrompt !== null}
        onClose={() => setReleasePrompt(null)}
        busy={statusMutation.isPending}
        danger
        title="Release with an unpaid balance?"
        confirmLabel="Release anyway"
        message={
          releasePrompt ? (
            <>
              <strong>{releasePrompt.transaction.customerName}</strong> still owes{' '}
              <strong className="tnum">{peso(releasePrompt.balance)}</strong>. Releasing now keeps
              that balance recorded as outstanding.
            </>
          ) : null
        }
        onConfirm={() => {
          if (!releasePrompt) return;
          statusMutation.mutate(
            {
              transactionId: releasePrompt.transaction.transactionId,
              orderStatus: 'Picked Up',
              acknowledgeBalance: true,
            },
            { onSettled: () => setReleasePrompt(null) },
          );
        }}
      />
    </>
  );
}
