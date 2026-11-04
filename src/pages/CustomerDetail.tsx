import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Phone, ShoppingCart } from 'lucide-react';
import { PAYMENT_STATUSES } from '@shared/constants';
import { formatLongDate } from '@shared/datetime';
import type { CustomerDto, CustomerStatsDto, Paginated, TransactionDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { TransactionList } from '@/components/TransactionList';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Table';
import { EmptyState, ErrorState, Skeleton, SkeletonTable } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { initials, peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={'mt-1 text-lg font-bold tnum ' + (tone ?? 'text-navy-900')}>{value}</p>
    </div>
  );
}

function EditCustomerDialog({
  customer,
  open,
  onClose,
}: {
  customer: CustomerDto;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [fullName, setFullName] = useState(customer.fullName);
  const [contactNumber, setContactNumber] = useState(customer.contactNumber);
  const [address, setAddress] = useState(customer.address);
  const [notes, setNotes] = useState(customer.notes);

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch<{ customer: CustomerDto }>('/customers/' + customer.customerId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer updated');
      onClose();
    },
    onError: (error) => toast.error('Unable to update customer', errorMessage(error)),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Edit customer"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Save these details?',
                confirmLabel: 'Save changes',
                message: (
                  <>
                    The record for <strong>{fullName.trim()}</strong> will be updated.
                  </>
                ),
              });
              if (ok) {
                mutation.mutate({
                  fullName: fullName.trim(),
                  contactNumber: contactNumber.trim(),
                  address: address.trim(),
                  notes: notes.trim(),
                });
              }
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
          disabled={mutation.isPending}
        />
        <Input
          label="Contact number"
          value={contactNumber}
          onChange={(event) => setContactNumber(event.target.value)}
          inputMode="tel"
          required
          disabled={mutation.isPending}
        />
        <Input
          label="Address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          disabled={mutation.isPending}
        />
        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          hint="Preferences, garment instructions, reminders."
          disabled={mutation.isPending}
        />
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}

export default function CustomerDetail() {
  const { customerId = '' } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [payFilter, setPayFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const profile = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: ({ signal }) =>
      api.get<{ customer: CustomerDto; stats: CustomerStatsDto }>(
        '/customers/' + customerId,
        undefined,
        signal,
      ),
    enabled: Boolean(customerId),
  });

  /*
   * The general transactions endpoint rather than the customer-specific one:
   * it already understands payment status and date ranges, so filtering here
   * needs no new API. Staff still only receive unpaid orders, which the server
   * enforces regardless of what is asked for.
   */
  const history = useQuery({
    queryKey: ['transactions', 'customer', customerId, page, payFilter, fromDate, toDate],
    queryFn: ({ signal }) =>
      api.get<Paginated<TransactionDto>>(
        '/transactions',
        {
          customerId,
          page,
          pageSize: 15,
          paymentStatus: payFilter || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          includeCancelled: true,
          sortBy: 'date',
          sortDir: 'desc',
        },
        signal,
      ),
    enabled: Boolean(customerId),
    placeholderData: keepPreviousData,
  });

  const { can } = useAuth();
  const isAdmin = can('customers.viewSpending');
  /*
   * Staff are served only orders that still owe money — the server enforces it
   * on every transaction read, not just the Transactions screen. So this list
   * is genuinely shorter for them, and the page has to say so: a history that
   * silently omits settled orders reads as "this customer never came in".
   */
  const unpaidOnly = !isAdmin;
  const filtersOn = Boolean(payFilter || fromDate || toDate);
  const customer = profile.data?.customer;
  const stats = profile.data?.stats;
  useDocumentTitle(customer?.fullName ?? 'Customer');

  if (profile.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (profile.isError || !customer || !stats) {
    return (
      <div className="card">
        <ErrorState
          title="Customer not found"
          message={profile.error instanceof Error ? profile.error.message : undefined}
          onRetry={() => void profile.refetch()}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={customer.fullName}
        subtitle={customer.customerId + ' \u00B7 registered ' + formatLongDate(customer.registrationDate)}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            >
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
            >
              Edit
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/pos')}
              icon={<ShoppingCart className="h-4 w-4" aria-hidden="true" />}
            >
              New sale
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody>
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy-900 text-lg font-semibold text-white">
                {initials(customer.fullName)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-navy-900">{customer.fullName}</p>
                {customer.contactNumber ? (
                  <a
                    href={'tel:' + customer.contactNumber}
                    className="flex items-center gap-1 text-sm text-brand-700 hover:underline tnum"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    {customer.contactNumber}
                  </a>
                ) : (
                  <span className="text-sm text-slate-400">No contact number</span>
                )}
              </div>
            </div>

            {customer.address ? (
              <p className="mt-3 text-sm text-slate-600">{customer.address}</p>
            ) : null}
            {customer.notes ? (
              <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                {customer.notes}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <StatTile label="Orders" value={String(stats.totalTransactions)} />
              {isAdmin ? <StatTile label="Total spent" value={peso(stats.totalSpending)} /> : null}
              <StatTile
                label="Outstanding"
                value={peso(stats.outstandingBalance)}
                tone={stats.outstandingBalance > 0 ? 'text-red-600' : 'text-emerald-700'}
              />
              <StatTile label="Active orders" value={String(stats.activeOrders)} />
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Last visit</dt>
                <dd className="font-medium text-navy-800 tnum">
                  {stats.lastTransactionDate
                    ? formatLongDate(stats.lastTransactionDate)
                    : '\u2014'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Usual service</dt>
                <dd className="font-medium text-navy-800">
                  {stats.favouriteService ?? '\u2014'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Status</dt>
                <dd className="font-medium text-navy-800">{customer.status}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={unpaidOnly ? 'Unpaid orders' : 'Transaction history'}
            subtitle={
              history.data
                ? unpaidOnly
                  ? history.data.total + ' still to collect'
                  : history.data.total + (history.data.total === 1 ? ' record' : ' records')
                : undefined
            }
            action={
              filtersOn ? (
                <button
                  type="button"
                  onClick={() => {
                    setPayFilter('');
                    setFromDate('');
                    setToDate('');
                    setPage(1);
                  }}
                  className="text-xs font-medium text-brand-700 hover:text-brand-800"
                >
                  Clear filters
                </button>
              ) : null
            }
          />

          <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-3">
            {/* Pointless for staff: "Paid" could only ever come back empty. */}
            {unpaidOnly ? null : (
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="history-payment" className="label">
                  Payment
                </label>
                <select
                  id="history-payment"
                  value={payFilter}
                  onChange={(event) => {
                    setPayFilter(event.target.value);
                    setPage(1);
                  }}
                  className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
                >
                  <option value="">All payments</option>
                  {PAYMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="history-from" className="label">
                From
              </label>
              <input
                id="history-from"
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setPage(1);
                }}
                className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor="history-to" className="label">
                To
              </label>
              <input
                id="history-to"
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setPage(1);
                }}
                className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
              />
            </div>
          </div>
          {history.isLoading ? (
            <SkeletonTable rows={5} columns={6} />
          ) : (history.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title={
                filtersOn
                  ? 'Nothing matches those filters.'
                  : unpaidOnly
                    ? 'Nothing to collect.'
                    : 'No transactions yet.'
              }
              message={
                filtersOn
                  ? 'Try a wider date range, or clear the filters.'
                  : unpaidOnly
                    ? 'This customer has no unpaid orders. Settled orders are not shown here.'
                    : 'This customer has not placed an order.'
              }
              action={
                filtersOn ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPayFilter('');
                      setFromDate('');
                      setToDate('');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => navigate('/pos')}>
                    {unpaidOnly ? 'New sale' : 'Create the first sale'}
                  </Button>
                )
              }
            />
          ) : (
            <>
              <TransactionList items={history.data?.items ?? []} showCustomer={false} />
              <Pagination
                page={history.data?.page ?? 1}
                pageSize={history.data?.pageSize ?? 15}
                total={history.data?.total ?? 0}
                totalPages={history.data?.totalPages ?? 1}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      </div>

      <EditCustomerDialog customer={customer} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}
