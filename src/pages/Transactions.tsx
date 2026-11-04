import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Filter, ReceiptText as ReceiptIcon, Search, X } from 'lucide-react';
import {
  ORDER_STATUSES,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
} from '@shared/constants';
import { formatShortDate } from '@shared/datetime';
import type { Paginated, ServiceDto, TransactionDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { PaymentDialog } from '@/components/PaymentDialog';
import { TransactionList } from '@/components/TransactionList';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Table';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { useAuth } from '@/auth/AuthProvider';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { exportCsv } from '@/lib/csv';
import { peso } from '@/lib/format';

const PAGE_SIZE = 25;

/**
 * The views a counter actually asks for, in the order it asks for them.
 *
 * "Not paid" leads because it is why this screen gets opened during a shift —
 * a customer is standing there to settle up. It covers both Unpaid and
 * Partially Paid, which a single status filter cannot express. "All" sits last
 * as the fall-back for looking something up.
 */
const TABS = [
  { id: 'notpaid', label: 'Not paid' },
  { id: 'active', label: 'In shop' },
  { id: 'pickedup', label: 'Picked up' },
  { id: 'all', label: 'All' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const DEFAULT_TAB: TabId = 'notpaid';

export default function Transactions() {
  useDocumentTitle('Transactions');
  const { can } = useAuth();
  const isAdmin = can('orders.viewAll');
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [collecting, setCollecting] = useState<TransactionDto | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  /*
   * Staff work the "Not paid" list and nothing else. The server already limits
   * what they are given, so the other tabs would only return the same rows
   * under a heading that lies about what is in them — better to remove them.
   */
  const tabs = isAdmin ? TABS : TABS.filter((entry) => entry.id === 'notpaid');
  const requested = (searchParams.get('tab') ?? DEFAULT_TAB) as TabId;
  const tab: TabId = isAdmin ? requested : DEFAULT_TAB;
  const paymentStatus = searchParams.get('paymentStatus') ?? '';
  const orderStatus = searchParams.get('orderStatus') ?? '';
  const modeOfPayment = searchParams.get('modeOfPayment') ?? '';
  const serviceId = searchParams.get('serviceId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const includeCancelled = searchParams.get('includeCancelled') === 'true';

  /** What each tab adds on top of whatever filters are set. */
  const tabQuery: Record<string, string | boolean | undefined> =
    tab === 'notpaid'
      ? { outstanding: true }
      : tab === 'pickedup'
        ? { orderStatus: 'Picked Up' }
        : tab === 'active'
          ? { pickupStatus: 'Pending' }
          : {};

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams);
    if (next === DEFAULT_TAB) params.delete('tab');
    else params.set('tab', next);
    // The tab owns order status; leaving a stale one set would show an empty
    // list with no visible reason.
    params.delete('orderStatus');
    setSearchParams(params, { replace: true });
    setPage(1);
  };

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setSearch('');
    setPage(1);
  };

  const activeFilterCount = [
    paymentStatus,
    orderStatus,
    modeOfPayment,
    serviceId,
    from,
    to,
  ].filter(Boolean).length;

  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: ({ signal }) => api.get<{ items: ServiceDto[] }>('/services', undefined, signal),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });

  const query = useQuery({
    queryKey: [
      'transactions',
      { tab, debouncedSearch, page, paymentStatus, orderStatus, modeOfPayment, serviceId, from, to, includeCancelled },
    ],
    queryFn: ({ signal }) =>
      api.get<Paginated<TransactionDto>>(
        '/transactions',
        {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
          paymentStatus: paymentStatus || undefined,
          orderStatus: orderStatus || undefined,
          modeOfPayment: modeOfPayment || undefined,
          serviceId: serviceId || undefined,
          from: from || undefined,
          to: to || undefined,
          includeCancelled: includeCancelled || undefined,
          ...tabQuery,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });

  const items = query.data?.items ?? [];

  const download = () => {
    exportCsv('transactions-' + new Date().toISOString().slice(0, 10), items, [
      { header: 'Transaction ID', value: (row) => row.transactionId },
      { header: 'O.R. Number', value: (row) => row.orNumber },
      { header: 'Date', value: (row) => formatShortDate(row.transactionDate) },
      { header: 'Customer', value: (row) => row.customerName },
      { header: 'Contact', value: (row) => row.contactNumber },
      { header: 'Service', value: (row) => row.serviceType },
      { header: 'Quantity', value: (row) => row.quantity },
      { header: 'Unit Price', value: (row) => row.unitPrice.toFixed(2) },
      { header: 'Discount', value: (row) => row.discount.toFixed(2) },
      { header: 'Additional Charge', value: (row) => row.additionalCharge.toFixed(2) },
      { header: 'Total', value: (row) => row.totalPayment.toFixed(2) },
      { header: 'Paid', value: (row) => row.paidAmount.toFixed(2) },
      { header: 'Balance', value: (row) => row.balance.toFixed(2) },
      { header: 'Payment Status', value: (row) => row.paymentStatus },
      { header: 'Mode', value: (row) => row.modeOfPayment },
      { header: 'Order Status', value: (row) => row.orderStatus },
      { header: 'Created By', value: (row) => row.createdBy },
    ]);
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={
          query.data
            ? query.data.total + ' record' + (query.data.total === 1 ? '' : 's')
            : 'Search, filter and review every sale.'
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={download}
            disabled={items.length === 0}
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
          >
            Export CSV
          </Button>
        }
      />

      <div className="card mb-4">
        {/* Horizontally scrollable so four tabs never wrap or shrink the text
            on a narrow phone. */}
        <div
          className={cn(
            'flex gap-1 overflow-x-auto border-b border-slate-200 px-2 pt-2',
            tabs.length < 2 && 'hidden',
          )}
          role="tablist"
          aria-label="Transaction views"
        >
          {tabs.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(entry.id)}
                className={cn(
                  'shrink-0 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-navy-800',
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search O.R. number, transaction ID, customer or contact"
              aria-label="Search transactions"
              className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <Button
            variant={activeFilterCount > 0 ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
            icon={<Filter className="h-4 w-4" aria-hidden="true" />}
          >
            Filters
            {activeFilterCount > 0 ? (
              <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs tnum">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </div>

        {showFilters ? (
          <div className="border-t border-slate-200 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Payment status"
                value={paymentStatus}
                onChange={(event) => setFilter('paymentStatus', event.target.value)}
              >
                <option value="">All</option>
                {PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>

              <Select
                label="Order status"
                value={orderStatus}
                onChange={(event) => setFilter('orderStatus', event.target.value)}
              >
                <option value="">All</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>

              <Select
                label="Payment method"
                value={modeOfPayment}
                onChange={(event) => setFilter('modeOfPayment', event.target.value)}
              >
                <option value="">All</option>
                {PAYMENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </Select>

              <Select
                label="Service"
                value={serviceId}
                onChange={(event) => setFilter('serviceId', event.target.value)}
              >
                <option value="">All</option>
                {services?.map((service) => (
                  <option key={service.serviceId} value={service.serviceId}>
                    {service.name}
                  </option>
                ))}
              </Select>

              <div>
                <label htmlFor="filter-from" className="label">
                  From
                </label>
                <input
                  id="filter-from"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFilter('from', event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
                />
              </div>
              <div>
                <label htmlFor="filter-to" className="label">
                  To
                </label>
                <input
                  id="filter-to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setFilter('to', event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
                />
              </div>

              {isAdmin ? (
                <label className="flex items-end gap-2 pb-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeCancelled}
                    onChange={(event) =>
                      setFilter('includeCancelled', event.target.checked ? 'true' : '')
                    }
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Include cancelled
                </label>
              ) : null}
            </div>

            {activeFilterCount > 0 || search ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={clearFilters}
                icon={<X className="h-4 w-4" aria-hidden="true" />}
              >
                Clear all filters
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        {query.isLoading ? (
          <SkeletonTable rows={8} columns={7} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load transactions"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ReceiptIcon className="h-6 w-6" aria-hidden="true" />}
            title="No transactions found."
            message={
              search || activeFilterCount > 0
                ? 'Try widening your search or clearing the filters.'
                : 'Completed sales will appear here.'
            }
            action={
              search || activeFilterCount > 0 ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <TransactionList items={items} onCollect={setCollecting} />
            <Pagination
              page={query.data?.page ?? 1}
              pageSize={query.data?.pageSize ?? PAGE_SIZE}
              total={query.data?.total ?? 0}
              totalPages={query.data?.totalPages ?? 1}
              onPageChange={setPage}
            />
          </>
        )}
      </div>

      {items.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          Page total:{' '}
          <span className="font-medium text-navy-800 tnum">
            {peso(items.reduce((sum, item) => sum + item.totalPayment, 0))}
          </span>
          {tab === 'notpaid' ? (
            <>
              {' · '}Outstanding:{' '}
              <span className="font-medium text-red-600 tnum">
                {peso(items.reduce((sum, item) => sum + item.balance, 0))}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      <PaymentDialog
        transaction={collecting}
        open={collecting !== null}
        onClose={() => setCollecting(null)}
        onSettled={() => void query.refetch()}
      />
    </>
  );
}
