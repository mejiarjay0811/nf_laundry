import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Flame, Plug, Plus, Trash2 } from 'lucide-react';
import type { GasLogDto, GasSummaryDto, GasTankDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Td, Th, Tr, TableWrap } from '@/components/ui/Table';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

interface GasPayload {
  summary: GasSummaryDto;
  tanks: GasTankDto[];
  logs: GasLogDto[];
}

/**
 * LPG — the second-biggest running cost after wages, and the one nobody can
 * normally put a number on.
 *
 * The headline is cost per dryer cycle, and the screen is careful about when
 * it claims to know it: a tank still running shows cycles so far and an
 * estimate drawn from past tanks, clearly labelled as an estimate. The real
 * figure only appears once a tank is spent, because that is the first moment
 * it is true.
 */
function AddTankDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [supplier, setSupplier] = useState('');
  const [sizeKg, setSizeKg] = useState('11');
  const [cost, setCost] = useState('');
  const [asExpense, setAsExpense] = useState(true);

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/gas/tanks', {
        label: label.trim(),
        supplier: supplier.trim() || undefined,
        sizeKg: Number(sizeKg || 0),
        purchaseCost: Number(cost || 0),
        recordAsExpense: asExpense,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gas'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Tank recorded', asExpense ? 'Also booked as an expense.' : undefined);
      setLabel('');
      setCost('');
      onClose();
    },
    onError: (error) => toast.error('Could not record the tank', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buy a tank"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={label.trim().length < 1 || !cost}
            onClick={() => mutation.mutate()}
          >
            Record tank
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Label"
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Tank A"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Size (kg)"
            type="number"
            inputMode="decimal"
            min={1}
            value={sizeKg}
            onChange={(event) => setSizeKg(event.target.value)}
          />
          <Input
            label="Cost"
            required
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            placeholder="0.00"
          />
        </div>
        <Input
          label="Supplier"
          value={supplier}
          onChange={(event) => setSupplier(event.target.value)}
        />
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={asExpense}
            onChange={(event) => setAsExpense(event.target.checked)}
          />
          <span>
            <span className="font-medium text-navy-900">Record this as an expense</span>
            <span className="block text-xs text-slate-500">
              So the gas appears in this month&rsquo;s spending without being entered twice.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function EmptyTankDialog({
  tank,
  countedCycles,
  open,
  onClose,
}: {
  tank: GasTankDto | null;
  countedCycles: number;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [override, setOverride] = useState('');
  const [notes, setNotes] = useState('');

  const cycles = override === '' ? countedCycles : Number(override);
  const perCycle = cycles > 0 ? (tank?.purchaseCost ?? 0) / cycles : 0;

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/gas/tanks/' + tank?.tankId + '/empty', {
        cyclesOverride: override === '' ? undefined : Number(override),
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gas'] });
      toast.success('Tank marked empty');
      setOverride('');
      setNotes('');
      onClose();
    },
    onError: (error) => toast.error('Could not mark the tank empty', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'Mark ' + (tank?.label ?? '') + ' empty'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Mark empty
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {countedCycles} dryer {countedCycles === 1 ? 'cycle was' : 'cycles were'} logged while
          this tank was connected. This is the moment the true cost per cycle is worked out, so
          it is worth getting right.
        </p>
        <Input
          label="Cycles served"
          hint="Leave blank to use the counted figure. Enter a number only if loads went unlogged."
          type="number"
          inputMode="numeric"
          min={0}
          value={override}
          onChange={(event) => setOverride(event.target.value)}
          placeholder={String(countedCycles)}
        />
        {cycles > 0 ? (
          <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
            Works out at {peso(perCycle)} per dryer cycle.
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            With no cycles recorded, no cost per cycle can be worked out for this tank.
          </div>
        )}
        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  );
}

export default function Gas() {
  useDocumentTitle('Gas');
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [emptying, setEmptying] = useState<GasTankDto | null>(null);

  const query = useQuery({
    queryKey: ['gas'],
    queryFn: ({ signal }) => api.get<GasPayload>('/gas', undefined, signal),
    staleTime: 60_000,
  });

  const install = useMutation({
    mutationFn: (tankId: string) => api.post('/gas/tanks/' + tankId + '/install'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gas'] });
      toast.success('Tank connected');
    },
    onError: (error) => toast.error('Could not connect the tank', errorMessage(error)),
  });

  const summary = query.data?.summary;
  const tanks = query.data?.tanks ?? [];

  const tiles = [
    {
      label: 'Cost per cycle',
      value: summary?.averageCostPerCycle === null ? '—' : peso(summary?.averageCostPerCycle ?? 0),
      note: summary?.averageCostPerCycle === null ? 'No spent tank yet' : 'Average, spent tanks',
    },
    {
      label: 'On this tank',
      value: String(summary?.cyclesOnCurrentTank ?? 0),
      note: 'dryer cycles so far',
    },
    {
      label: 'Est. cycles left',
      value:
        summary?.estimatedCyclesRemaining === null
          ? '—'
          : String(summary?.estimatedCyclesRemaining ?? 0),
      note: summary?.estimatedCyclesRemaining === null ? 'Needs a spent tank' : 'Estimate only',
    },
    { label: 'Spare tanks', value: String(summary?.tanksInStock ?? 0), note: 'full, in stock' },
  ];

  return (
    <>
      <PageHeader
        title="Gas"
        subtitle="LPG tanks, the cycles they run, and what each one actually costs."
        actions={
          can('gas.manage') ? (
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Buy a tank
            </Button>
          ) : null
        }
      />

      {query.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState
            title="Could not load the gas figures"
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((tile) => (
              <Card key={tile.label}>
                <CardBody className="py-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {tile.label}
                  </p>
                  <p className="mt-1 text-xl font-bold text-navy-900 tnum sm:text-2xl">
                    {tile.value}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{tile.note}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          {summary?.activeTank ? (
            <Card className="mt-4 border border-brand-200 bg-brand-50/40">
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Flame className="h-6 w-6 shrink-0 text-brand-600" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-navy-900">
                      {summary.activeTank.label} is connected
                    </p>
                    <p className="text-sm text-slate-600 tnum">
                      {summary.activeTank.sizeKg}kg · {peso(summary.activeTank.purchaseCost)} ·{' '}
                      {summary.cyclesOnCurrentTank} cycles so far
                    </p>
                  </div>
                </div>
                {can('gas.manage') ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setEmptying(summary.activeTank)}
                  >
                    Mark empty
                  </Button>
                ) : null}
              </CardBody>
            </Card>
          ) : (
            <Card className="mt-4">
              <EmptyState
                icon={<Flame className="h-6 w-6" aria-hidden="true" />}
                title="No tank connected."
                message="Connect a full tank so the dryer cycles it powers can be counted against it."
              />
            </Card>
          )}

          <Card className="mt-4">
            <CardHeader title="Tanks" subtitle="Newest first." />
            {tanks.length === 0 ? (
              <EmptyState title="No tanks recorded yet." />
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Tank</Th>
                      <Th>Status</Th>
                      <Th align="right">Cost</Th>
                      <Th align="right">Cycles</Th>
                      <Th align="right">Per cycle</Th>
                      <Th align="right">Action</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tanks.map((tank) => (
                      <Tr key={tank.tankId}>
                        <Td>
                          <span className="font-medium text-navy-900">{tank.label}</span>
                          <span className="block text-xs text-slate-500 tnum">
                            {tank.sizeKg}kg{tank.supplier ? ' · ' + tank.supplier : ''}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                              tank.status === 'In Use'
                                ? 'bg-brand-50 text-brand-700'
                                : tank.status === 'Full'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600',
                            )}
                          >
                            {tank.status}
                          </span>
                        </Td>
                        <Td align="right" className="tnum">
                          {peso(tank.purchaseCost)}
                        </Td>
                        <Td align="right" className="tnum">
                          {tank.status === 'Full' ? '—' : tank.cyclesServed}
                        </Td>
                        <Td align="right" className="tnum">
                          {tank.costPerCycle === null ? (
                            <span className="text-xs text-slate-400">not yet known</span>
                          ) : (
                            peso(tank.costPerCycle)
                          )}
                        </Td>
                        <Td align="right">
                          {can('gas.manage') && tank.status === 'Full' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              loading={install.isPending}
                              icon={<Plug className="h-4 w-4" aria-hidden="true" />}
                              onClick={() => {
                                void (async () => {
                                  const ok = await confirm({
                                    title: 'Connect ' + tank.label + '?',
                                    confirmLabel: 'Connect',
                                    message:
                                      'Dryer cycles from now on will be counted against this tank.',
                                  });
                                  if (ok) install.mutate(tank.tankId);
                                })();
                              }}
                            >
                              Connect
                            </Button>
                          ) : null}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      {confirmDialog}
      <AddTankDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <EmptyTankDialog
        tank={emptying}
        countedCycles={summary?.cyclesOnCurrentTank ?? 0}
        open={Boolean(emptying)}
        onClose={() => setEmptying(null)}
      />
    </>
  );
}
