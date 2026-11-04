import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Banknote, Plus, Search, Smartphone, Wallet } from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  PAYMENT_MODES,
  SETTINGS_KEYS,
  type PaymentMode,
} from '@shared/constants';
import { formatShortDate, manilaDateKey } from '@shared/datetime';
import type { ExpenseDto, Paginated } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Table';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { exportCsv } from '@/lib/csv';
import { peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

const PAGE_SIZE = 25;

function refresh(): void {
  for (const key of ['expenses', 'profit', 'dashboard']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/* ------------------------------------------------------------ the form */

function ExpenseDialog({
  expense,
  open,
  onClose,
}: {
  expense: ExpenseDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const editing = expense !== null;

  const [category, setCategory] = useState<string>(expense?.category ?? 'Salary');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? expense.amount.toFixed(2) : '');
  const [modeOfPayment, setModeOfPayment] = useState<PaymentMode>(
    (expense?.modeOfPayment as PaymentMode) ?? 'Cash',
  );
  const [paidTo, setPaidTo] = useState(expense?.paidTo ?? '');
  const [expenseDate, setExpenseDate] = useState(
    expense?.expenseDate?.slice(0, 10) ?? manilaDateKey(),
  );
  const [notes, setNotes] = useState(expense?.notes ?? '');

  /*
   * The shop's usual wage, offered when Salary is chosen and the amount is
   * still blank. It is a starting point, not a rule — a short week is still a
   * short week — so it never overwrites something already typed.
   */
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => api.get<{ settings: Record<string, string> }>('/settings', undefined, signal),
    staleTime: 5 * 60_000,
  });
  const usualSalary = Number(settings?.settings?.[SETTINGS_KEYS.staffSalary] ?? 0) || 0;
  const salaryPeriod = settings?.settings?.[SETTINGS_KEYS.staffSalaryPeriod] ?? '';

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<{ expense: ExpenseDto }>('/expenses/' + expense.expenseId, body)
        : api.post<{ expense: ExpenseDto }>('/expenses', body),
    onSuccess: () => {
      refresh();
      toast.success(editing ? 'Expense updated' : 'Expense recorded');
      onClose();
    },
    onError: (error) => toast.error('Unable to save the expense', errorMessage(error)),
  });

  const value = Number(amount) || 0;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        busy={mutation.isPending}
        title={editing ? 'Edit expense' : 'Record an expense'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={description.trim().length < 2 || value <= 0}
              onClick={async () => {
                const ok = await confirm({
                  title: editing ? 'Save this expense?' : 'Record this expense?',
                  confirmLabel: editing ? 'Save changes' : 'Record expense',
                  message: (
                    <>
                      <strong>{peso(value)}</strong> for{' '}
                      <strong>{description.trim()}</strong> under {category}, paid by{' '}
                      {modeOfPayment}.
                      <span className="mt-2 block text-slate-500">
                        It will count against the takings for {formatShortDate(expenseDate)}.
                      </span>
                    </>
                  ),
                });
                if (!ok) return;
                mutation.mutate({
                  category,
                  description: description.trim(),
                  amount: value,
                  modeOfPayment,
                  paidTo: paidTo.trim(),
                  expenseDate,
                  notes: notes.trim(),
                });
              }}
            >
              {editing ? 'Save changes' : 'Record expense'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select
            label="Category"
            value={category}
            onChange={(event) => {
              const next = event.target.value;
              setCategory(next);
              if (next === 'Salary' && !amount.trim() && usualSalary > 0) {
                setAmount(usualSalary.toFixed(2));
                if (!description.trim()) setDescription('Staff salary');
              }
            }}
          >
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>

          <Input
            label="What was it for"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Staff wages for the week"
            required
          />

          <Input
            label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            leading={<span className="text-sm">{'₱'}</span>}
            placeholder="0.00"
            className="text-lg font-semibold tnum"
            {...(category === 'Salary' && usualSalary > 0
              ? {
                  hint:
                    'The shop\'s usual ' +
                    (salaryPeriod ? salaryPeriod.toLowerCase() + ' ' : '') +
                    'wage is ' +
                    usualSalary.toFixed(2),
                }
              : {})}
          />

          <div>
            <span className="label" id="expense-mode">
              Paid with
            </span>
            <div role="radiogroup" aria-labelledby="expense-mode" className="grid grid-cols-2 gap-2">
              {PAYMENT_MODES.map((option) => {
                const Icon = option === 'Cash' ? Banknote : Smartphone;
                const active = modeOfPayment === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setModeOfPayment(option)}
                    className={cn(
                      'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium',
                      active
                        ? 'border-navy-900 bg-navy-900 text-white'
                        : 'border-slate-300 bg-white text-navy-700 hover:bg-slate-50',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Paid to"
              value={paidTo}
              onChange={(event) => setPaidTo(event.target.value)}
              hint="Optional"
            />
            <div>
              <label htmlFor="expense-date" className="label">
                Date
              </label>
              <input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={(event) => setExpenseDate(event.target.value)}
                className="h-12 w-full rounded-lg border border-slate-300 px-3 text-base focus:border-brand-500 sm:h-11 sm:text-sm"
              />
            </div>
          </div>

          <Textarea
            label="Notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional"
          />
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}

/* ------------------------------------------------------------- screen */

export default function Expenses() {
  useDocumentTitle('Expenses');
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const debounced = useDebounce(search, 300);

  const query = useQuery({
    queryKey: ['expenses', { debounced, category, from, to, page }],
    queryFn: ({ signal }) =>
      api.get<Paginated<ExpenseDto>>(
        '/expenses',
        {
          page,
          pageSize: PAGE_SIZE,
          search: debounced || undefined,
          category: category || undefined,
          from: from || undefined,
          to: to || undefined,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const voidMutation = useMutation({
    mutationFn: ({ expenseId, reason }: { expenseId: string; reason: string }) =>
      api.post<{ expense: ExpenseDto }>('/expenses/' + expenseId + '/void', { reason }),
    onSuccess: () => {
      refresh();
      toast.success('Expense voided', 'The record has been kept.');
    },
    onError: (error) => toast.error('Unable to void the expense', errorMessage(error)),
  });

  const items = query.data?.items ?? [];
  const pageTotal = items.reduce((sum, item) => sum + item.amount, 0);

  const download = () =>
    exportCsv('expenses-' + manilaDateKey(), items, [
      { header: 'Expense ID', value: (row) => row.expenseId },
      { header: 'Date', value: (row) => row.expenseDate },
      { header: 'Category', value: (row) => row.category },
      { header: 'Description', value: (row) => row.description },
      { header: 'Amount', value: (row) => row.amount.toFixed(2) },
      { header: 'Paid With', value: (row) => row.modeOfPayment },
      { header: 'Paid To', value: (row) => row.paidTo },
      { header: 'Recorded By', value: (row) => row.recordedBy },
    ]);

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="Wages, supplies, rent — everything the shop pays out."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={download}
              disabled={items.length === 0}
            >
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => setAdding(true)}
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Record expense
            </Button>
          </div>
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
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search description or who was paid"
              aria-label="Search expenses"
              className="h-11 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by category"
            className="h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
          >
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md">
          <div>
            <label htmlFor="expense-from" className="label">
              From
            </label>
            <input
              id="expense-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="expense-to" className="label">
              To
            </label>
            <input
              id="expense-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Recorded expenses"
          subtitle={(query.data?.total ?? 0) + ' entries'}
          action={
            <span className="text-sm font-semibold text-navy-900 tnum">
              Page total {peso(pageTotal)}
            </span>
          }
        />
        {query.isLoading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load expenses"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-6 w-6" aria-hidden="true" />}
            title="No expenses recorded."
            message="Record wages, supplies and bills here, and they will be set against the takings."
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Record the first one
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Category</Th>
                    <Th>Description</Th>
                    <Th>Paid to</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">{''}</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((expense) => (
                    <Tr key={expense.expenseId}>
                      <Td className="whitespace-nowrap text-slate-600 tnum">
                        {formatShortDate(expense.expenseDate)}
                      </Td>
                      <Td>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-navy-800">
                          {expense.category}
                        </span>
                      </Td>
                      <Td className="font-medium text-navy-900">{expense.description}</Td>
                      <Td className="text-slate-600">{expense.paidTo || '—'}</Td>
                      <Td align="right" className="font-semibold text-red-600">
                        {peso(expense.amount)}
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing(expense)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-navy-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Void this expense?',
                                confirmLabel: 'Void it',
                                danger: true,
                                message: (
                                  <>
                                    <strong>{peso(expense.amount)}</strong> for{' '}
                                    {expense.description} will stop counting against the takings.
                                    The row is kept and marked cancelled.
                                  </>
                                ),
                              });
                              if (ok) {
                                voidMutation.mutate({
                                  expenseId: expense.expenseId,
                                  reason: 'Voided from the expenses screen',
                                });
                              }
                            }}
                            aria-label={'Void ' + expense.description}
                            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          >
                            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-slate-100 sm:hidden">
              {items.map((expense) => (
                <li key={expense.expenseId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-navy-900">{expense.description}</p>
                      <p className="text-xs text-slate-500">
                        {expense.category} {'·'} {formatShortDate(expense.expenseDate)}
                        {expense.paidTo ? ' · ' + expense.paidTo : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold text-red-600 tnum">
                      {peso(expense.amount)}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setEditing(expense)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Void this expense?',
                          confirmLabel: 'Void it',
                          danger: true,
                          message: (
                            <>
                              <strong>{peso(expense.amount)}</strong> for {expense.description}{' '}
                              will stop counting against the takings.
                            </>
                          ),
                        });
                        if (ok) {
                          voidMutation.mutate({
                            expenseId: expense.expenseId,
                            reason: 'Voided from the expenses screen',
                          });
                        }
                      }}
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
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
      </Card>

      {adding ? <ExpenseDialog expense={null} open onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <ExpenseDialog
          key={editing.expenseId}
          expense={editing}
          open
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}
