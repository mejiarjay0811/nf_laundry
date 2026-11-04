import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Coins, Lock, Unlock } from 'lucide-react';
import { CASH_MOVEMENT_TYPES, type CashMovementType } from '@shared/constants';
import type { CashShiftDto, Paginated, ShiftReconciliationDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pagination, Td, Th, Tr, TableWrap } from '@/components/ui/Table';
import { EmptyState, ErrorState, Skeleton, SkeletonTable } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

/**
 * The drawer.
 *
 * The figure that matters is the variance, so it is the one given room: a
 * cashier who is fifty pesos short needs to see that before they go home, not
 * find it in a report next week. Everything else on this screen exists to
 * explain that number — the float it started from, the cash taken, and
 * anything put in or taken out since.
 */

function money(value: number | null | undefined): string {
  return peso(value ?? 0);
}

function VarianceChip({ variance }: { variance: number }) {
  const exact = Math.abs(variance) < 0.005;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tnum',
        exact
          ? 'bg-emerald-50 text-emerald-700'
          : variance > 0
            ? 'bg-amber-50 text-amber-700'
            : 'bg-red-50 text-red-700',
      )}
    >
      {exact ? 'Balanced' : (variance > 0 ? '+' : '') + money(variance)}
    </span>
  );
}

/* ------------------------------------------------------------- dialogs */

function OpenShiftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [openingFloat, setOpeningFloat] = useState('');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ shift: CashShiftDto }>('/shifts', {
        openingFloat: Number(openingFloat || 0),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift opened');
      setOpeningFloat('');
      setNote('');
      onClose();
    },
    onError: (error) => toast.error('Could not open the shift', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open a shift"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            icon={<Unlock className="h-4 w-4" aria-hidden="true" />}
            onClick={() => mutation.mutate()}
          >
            Open shift
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Opening float"
          hint="The cash already in the drawer before any sales. Zero is fine."
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={openingFloat}
          onChange={(event) => setOpeningFloat(event.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <Textarea
          label="Note"
          hint="Optional — anything worth recording at the start."
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  );
}

function CloseShiftDialog({
  shift,
  reconciliation,
  open,
  onClose,
}: {
  shift: CashShiftDto;
  reconciliation: ShiftReconciliationDto | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  const expected = reconciliation?.expectedCash ?? 0;
  const countedValue = Number(counted || 0);
  // Shown live as they type, so the discrepancy is visible before they commit
  // to it rather than appearing as a verdict afterwards.
  const variance = counted === '' ? null : countedValue - expected;

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ShiftReconciliationDto>('/shifts/' + shift.shiftId + '/close', {
        countedCash: countedValue,
        note: note.trim() || undefined,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      const off = result.shift.variance ?? 0;
      if (Math.abs(off) < 0.005) toast.success('Shift closed', 'The drawer balanced exactly.');
      else
        toast.success(
          'Shift closed',
          (off > 0 ? 'Over by ' : 'Short by ') + money(Math.abs(off)) + '.',
        );
      onClose();
    },
    onError: (error) => toast.error('Could not close the shift', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Close the shift"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={counted === ''}
            icon={<Lock className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              void (async () => {
                const ok = await confirm({
                  title: 'Close this shift?',
                  confirmLabel: 'Close shift',
                  message: (
                    <>
                      Counted {money(countedValue)} against {money(expected)} expected
                      {variance !== null && Math.abs(variance) >= 0.005 ? (
                        <>
                          {' '}
                          — a difference of <strong>{money(Math.abs(variance))}</strong>
                        </>
                      ) : null}
                      . A closed shift cannot be reopened.
                    </>
                  ),
                });
                if (ok) mutation.mutate();
              })();
            }}
          >
            Close shift
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {[
            ['Opening float', reconciliation?.openingFloat],
            ['Cash sales', reconciliation?.cashSales],
            ['Cash in', reconciliation?.cashIn],
            ['Cash out', reconciliation?.cashOut],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between px-3 py-2">
              <dt className="text-slate-600">{label}</dt>
              <dd className="font-medium text-navy-900 tnum">{money(value as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between bg-slate-50 px-3 py-2">
            <dt className="font-semibold text-navy-900">Expected in drawer</dt>
            <dd className="font-bold text-navy-900 tnum">{money(expected)}</dd>
          </div>
        </dl>

        <Input
          label="Counted cash"
          hint="What is actually in the drawer, counted."
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          placeholder="0.00"
          autoFocus
        />

        {variance !== null ? (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium',
              Math.abs(variance) < 0.005
                ? 'bg-emerald-50 text-emerald-800'
                : variance > 0
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-red-50 text-red-800',
            )}
          >
            {Math.abs(variance) < 0.005
              ? 'The drawer balances.'
              : variance > 0
                ? 'Over by ' + money(variance) + '.'
                : 'Short by ' + money(Math.abs(variance)) + '.'}
          </div>
        ) : null}

        <Textarea
          label="Closing note"
          hint="Explain any difference while it is still fresh."
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {confirmDialog}
      </div>
    </Modal>
  );
}

function CashMovementDialog({
  shiftId,
  open,
  onClose,
}: {
  shiftId: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [type, setType] = useState<CashMovementType>('Cash Out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/shifts/' + shiftId + '/movements', {
        type,
        amount: Number(amount || 0),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Recorded');
      setAmount('');
      setReason('');
      onClose();
    },
    onError: (error) => toast.error('Could not record that', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cash in or out"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!amount || reason.trim().length < 2}
            onClick={() => mutation.mutate()}
          >
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as CashMovementType)}
        >
          {CASH_MOVEMENT_TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
        <Input
          label="Amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Reason"
          hint="What the money was for — this is what the variance gets explained by."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Paid the water delivery"
        />
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- page */

export default function Shifts() {
  useDocumentTitle('Cash Shifts');
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [movementDialog, setMovementDialog] = useState(false);

  const current = useQuery({
    queryKey: ['shifts', 'current'],
    queryFn: ({ signal }) => api.get<{ shift: CashShiftDto | null }>('/shifts/current', undefined, signal),
    staleTime: 15_000,
  });

  const shift = current.data?.shift ?? null;

  const reconciliation = useQuery({
    queryKey: ['shifts', 'reconcile', shift?.shiftId],
    queryFn: ({ signal }) =>
      api.get<ShiftReconciliationDto>('/shifts/' + shift?.shiftId, undefined, signal),
    enabled: Boolean(shift),
    staleTime: 15_000,
  });

  const history = useQuery({
    queryKey: ['shifts', 'history', page],
    queryFn: ({ signal }) =>
      api.get<Paginated<CashShiftDto>>('/shifts', { page, pageSize: 15 }, signal),
    enabled: can('shifts.viewAll'),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Cash Shifts"
        subtitle="Open the drawer, record what moves through it, and count it at the end."
        actions={
          shift ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMovementDialog(true)}
                icon={<ArrowUpCircle className="h-4 w-4" aria-hidden="true" />}
              >
                Cash in/out
              </Button>
              <Button
                size="sm"
                onClick={() => setCloseDialog(true)}
                icon={<Lock className="h-4 w-4" aria-hidden="true" />}
              >
                Close shift
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => setOpenDialog(true)}
              icon={<Unlock className="h-4 w-4" aria-hidden="true" />}
            >
              Open shift
            </Button>
          )
        }
      />

      {current.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : current.isError ? (
        <Card>
          <ErrorState
            title="Could not load your shift"
            message={errorMessage(current.error)}
            onRetry={() => void current.refetch()}
          />
        </Card>
      ) : shift ? (
        <Card>
          <CardHeader
            title={'Open since ' + new Date(shift.openedAt).toLocaleString('en-PH')}
            subtitle={shift.fullName}
          />
          <CardBody>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: 'Opening float', value: reconciliation.data?.openingFloat },
                { label: 'Cash sales', value: reconciliation.data?.cashSales },
                { label: 'Cash in', value: reconciliation.data?.cashIn },
                { label: 'Cash out', value: reconciliation.data?.cashOut },
              ].map((tile) => (
                <div key={tile.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {tile.label}
                  </p>
                  <p className="mt-0.5 text-base font-semibold text-navy-900 tnum">
                    {money(tile.value)}
                  </p>
                </div>
              ))}
              <div className="col-span-2 rounded-lg bg-navy-900 px-3 py-2.5 sm:col-span-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-300">
                  Expected now
                </p>
                <p className="mt-0.5 text-base font-bold text-white tnum">
                  {money(reconciliation.data?.expectedCash)}
                </p>
              </div>
            </div>

            {reconciliation.data && reconciliation.data.movements.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Movements this shift
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {reconciliation.data.movements.map((movement) => (
                    <li
                      key={movement.movementId}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {movement.type === 'Cash In' || movement.type === 'Float' ? (
                          <ArrowDownCircle
                            className="h-4 w-4 shrink-0 text-emerald-600"
                            aria-hidden="true"
                          />
                        ) : (
                          <ArrowUpCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                        )}
                        <span className="truncate text-navy-800">{movement.reason}</span>
                      </span>
                      <span className="shrink-0 font-medium text-navy-900 tnum">
                        {money(movement.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<Coins className="h-6 w-6" aria-hidden="true" />}
            title="No shift open."
            message="Open one at the start of your turn so the drawer can be counted against the ledger at the end."
            action={<Button onClick={() => setOpenDialog(true)}>Open shift</Button>}
          />
        </Card>
      )}

      {can('shifts.viewAll') ? (
        <Card className="mt-4">
          <CardHeader title="Past shifts" subtitle="Counted against what the ledger expected." />
          {history.isLoading ? (
            <SkeletonTable rows={5} columns={6} />
          ) : (history.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No shifts recorded yet." />
          ) : (
            <>
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Cashier</Th>
                      <Th>Opened</Th>
                      <Th>Closed</Th>
                      <Th align="right">Expected</Th>
                      <Th align="right">Counted</Th>
                      <Th align="right">Variance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data?.items.map((entry) => (
                      <Tr key={entry.shiftId}>
                        <Td>{entry.fullName}</Td>
                        <Td className="whitespace-nowrap tnum">
                          {new Date(entry.openedAt).toLocaleString('en-PH')}
                        </Td>
                        <Td className="whitespace-nowrap tnum">
                          {entry.closedAt ? new Date(entry.closedAt).toLocaleString('en-PH') : '—'}
                        </Td>
                        <Td align="right" className="tnum">
                          {entry.expectedCash === null ? '—' : money(entry.expectedCash)}
                        </Td>
                        <Td align="right" className="tnum">
                          {entry.countedCash === null ? '—' : money(entry.countedCash)}
                        </Td>
                        <Td align="right">
                          {entry.variance === null ? (
                            <span className="text-xs text-slate-400">Open</span>
                          ) : (
                            <VarianceChip variance={entry.variance} />
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
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
      ) : null}

      <OpenShiftDialog open={openDialog} onClose={() => setOpenDialog(false)} />
      {shift ? (
        <>
          <CloseShiftDialog
            shift={shift}
            reconciliation={reconciliation.data}
            open={closeDialog}
            onClose={() => setCloseDialog(false)}
          />
          <CashMovementDialog
            shiftId={shift.shiftId}
            open={movementDialog}
            onClose={() => setMovementDialog(false)}
          />
        </>
      ) : null}
    </>
  );
}
