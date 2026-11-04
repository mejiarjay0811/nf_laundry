import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, Search, UserPlus, Users as UsersIcon } from 'lucide-react';
import { formatShortDate } from '@shared/datetime';
import type { CustomerDto, Paginated } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { exportCsv } from '@/lib/csv';
import { queryClient } from '@/lib/queryClient';
import { initials, peso } from '@/lib/format';

const PAGE_SIZE = 25;

function NewCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [fullName, setFullName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [address, setAddress] = useState('');

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.post<{ customer: CustomerDto }>('/customers', body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer registered', result.customer.fullName);
      setFullName('');
      setContactNumber('');
      setAddress('');
      onClose();
    },
    onError: (error) => toast.error('Unable to register customer', errorMessage(error)),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Register customer"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            // Plenty of walk-ins leave no number. One that IS typed still has to
            // be plausible, because a half-entered number is worse than none.
            disabled={
              fullName.trim().length < 2 ||
              (contactNumber.trim().length > 0 && contactNumber.replace(/\D/g, '').length < 7)
            }
            onClick={async () => {
              const ok = await confirm({
                title: 'Register this customer?',
                confirmLabel: 'Register',
                message: (
                  <>
                    <strong>{fullName.trim()}</strong>
                    {contactNumber.trim() ? ' · ' + contactNumber.trim() : ''}
                    {address.trim() ? ' · ' + address.trim() : ''}
                  </>
                ),
              });
              if (ok) {
                mutation.mutate({
                  fullName: fullName.trim(),
                  contactNumber: contactNumber.trim(),
                  address: address.trim(),
                });
              }
            }}
          >
            Save customer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          autoComplete="name"
          required
          autoFocus
          disabled={mutation.isPending}
        />
        <Input
          label="Contact number"
          value={contactNumber}
          onChange={(event) => setContactNumber(event.target.value)}
          inputMode="tel"
          placeholder="09XX XXX XXXX"
          hint="Optional"
          disabled={mutation.isPending}
        />
        <Input
          label="Address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          hint="Optional"
          disabled={mutation.isPending}
        />
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}

export default function Customers() {
  useDocumentTitle('Customers');
  const { can } = useAuth();
  const isAdmin = can('customers.viewSpending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'name' | 'recent' | 'spending' | 'transactions'>('name');
  const [dialogOpen, setDialogOpen] = useState(false);
  const debounced = useDebounce(search, 300);

  const query = useQuery({
    queryKey: ['customers', { debounced, page, sortBy }],
    queryFn: ({ signal }) =>
      api.get<Paginated<CustomerDto>>(
        '/customers',
        { page, pageSize: PAGE_SIZE, search: debounced || undefined, sortBy },
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const items = query.data?.items ?? [];

  const exportRows = () =>
    exportCsv('customers-' + new Date().toISOString().slice(0, 10), items, [
      { header: 'Customer ID', value: (row) => row.customerId },
      { header: 'Full Name', value: (row) => row.fullName },
      { header: 'Contact', value: (row) => row.contactNumber },
      { header: 'Address', value: (row) => row.address },
      { header: 'Registered', value: (row) => row.registrationDate },
      { header: 'Transactions', value: (row) => row.totalTransactions },
      // Omitted for staff: the export would otherwise hand over exactly what
      // the screen withholds.
      ...(isAdmin
        ? [{ header: 'Total Spending', value: (row: CustomerDto) => row.totalSpending.toFixed(2) }]
        : []),
      { header: 'Last Transaction', value: (row) => row.lastTransactionDate ?? '' },
      { header: 'Status', value: (row) => row.status },
    ]);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={
          query.data ? query.data.total + ' registered' : 'Search and manage customer records.'
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0}
              onClick={exportRows}
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
            >
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            >
              New customer
            </Button>
          </>
        }
      />

      <div className="card mb-4 flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
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
            placeholder="Search by name, contact number or customer ID"
            aria-label="Search customers"
            className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500"
          />
        </div>
        <Select
          aria-label="Sort customers"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
          containerClassName="sm:w-52"
          className="h-10"
        >
          <option value="name">Sort: Name</option>
          <option value="recent">Sort: Most recent</option>
          {/* Sorting by a figure staff cannot see would order the list by
              zeros, which reads as the sort being broken. */}
          {isAdmin ? <option value="spending">Sort: Highest spending</option> : null}
          <option value="transactions">Sort: Most orders</option>
        </Select>
      </div>

      <div className="card overflow-hidden">
        {query.isLoading ? (
          <SkeletonTable rows={8} columns={5} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load customers"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-6 w-6" aria-hidden="true" />}
            title="No customers found."
            message={
              debounced
                ? 'No one matches that search.'
                : 'Register your first customer to get started.'
            }
            action={
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                Register customer
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Contact</Th>
                    <Th align="right">Orders</Th>
                    <Th align="right" className={!isAdmin ? 'hidden' : undefined}>Total spent</Th>
                    <Th>Last visit</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((customer) => (
                    <Tr key={customer.customerId}>
                      <Td>
                        <Link
                          to={'/customers/' + customer.customerId}
                          className="flex items-center gap-2.5"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-navy-700">
                            {initials(customer.fullName)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-navy-900 hover:text-brand-700">
                              {customer.fullName}
                            </span>
                            <span className="block text-xs text-slate-400">
                              {customer.customerId}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td className="text-slate-600 tnum">{customer.contactNumber}</Td>
                      <Td align="right">{customer.totalTransactions}</Td>
                      <Td align="right" className={cn('font-medium', !isAdmin && 'hidden')}>
                        {peso(customer.totalSpending)}
                      </Td>
                      <Td className="text-slate-600 tnum">
                        {customer.lastTransactionDate
                          ? formatShortDate(customer.lastTransactionDate)
                          : '\u2014'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-slate-100 sm:hidden">
              {items.map((customer) => (
                <li key={customer.customerId}>
                  <Link
                    to={'/customers/' + customer.customerId}
                    className="flex items-center gap-3 px-4 py-3 active:bg-slate-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-navy-700">
                      {initials(customer.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-navy-900">
                        {customer.fullName}
                      </span>
                      <span className="block text-xs text-slate-500 tnum">
                        {customer.contactNumber}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {/* Staff are sent 0 for spending, so printing it would
                          read as "this customer has never spent anything". */}
                      {isAdmin ? (
                        <span className="block text-sm font-semibold text-navy-900 tnum">
                          {peso(customer.totalSpending)}
                        </span>
                      ) : null}
                      <span
                        className={
                          isAdmin
                            ? 'block text-xs text-slate-500'
                            : 'block text-sm font-semibold text-navy-900 tnum'
                        }
                      >
                        {customer.totalTransactions}
                        {customer.totalTransactions === 1 ? ' order' : ' orders'}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

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

      <NewCustomerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
