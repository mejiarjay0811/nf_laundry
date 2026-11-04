import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Plus, Square, WashingMachine, Wind, Wrench } from 'lucide-react';
import { MACHINE_TYPES, type MachineType } from '@shared/constants';
import type { MachineDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { queryClient } from '@/lib/queryClient';

/**
 * The floor, as a board.
 *
 * Cards rather than a table on purpose: the question this screen answers is
 * "which drum is free right now", and that is a glance, not a read. Colour
 * carries the state, and every card has a single obvious action — load it, or
 * take the load out.
 */

const TONE: Record<string, string> = {
  Available: 'border-emerald-200 bg-emerald-50',
  'In Use': 'border-brand-300 bg-brand-50',
  Maintenance: 'border-amber-200 bg-amber-50',
  Retired: 'border-slate-200 bg-slate-50',
};

const DOT: Record<string, string> = {
  Available: 'bg-emerald-500',
  'In Use': 'bg-brand-500',
  Maintenance: 'bg-amber-500',
  Retired: 'bg-slate-400',
};

/** How long the current load has been running, in plain words. */
function runningFor(startedAt: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 60000));
  if (minutes < 1) return 'just started';
  if (minutes < 60) return minutes + ' min';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

function AddMachineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<MachineType>('Washer');
  const [capacityKg, setCapacityKg] = useState('');
  const [cycleMinutes, setCycleMinutes] = useState('45');
  const [location, setLocation] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/machines', {
        name: name.trim(),
        type,
        capacityKg: Number(capacityKg || 0),
        cycleMinutes: Number(cycleMinutes || 45),
        location: location.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['machines'] });
      toast.success('Machine added');
      setName('');
      setCapacityKg('');
      setLocation('');
      onClose();
    },
    onError: (error) => toast.error('Could not add the machine', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a machine"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={name.trim().length < 1}
            onClick={() => mutation.mutate()}
          >
            Add machine
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Washer 1"
          autoFocus
        />
        <Select
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as MachineType)}
        >
          {MACHINE_TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Capacity (kg)"
            type="number"
            inputMode="decimal"
            min={0}
            value={capacityKg}
            onChange={(event) => setCapacityKg(event.target.value)}
            placeholder="8"
          />
          <Input
            label="Cycle (minutes)"
            type="number"
            inputMode="numeric"
            min={1}
            value={cycleMinutes}
            onChange={(event) => setCycleMinutes(event.target.value)}
          />
        </div>
        <Input
          label="Location"
          hint="Optional — useful once there is more than one row of machines."
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="e.g. Left wall"
        />
      </div>
    </Modal>
  );
}

function LoadDialog({
  machine,
  open,
  onClose,
}: {
  machine: MachineDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [orNumber, setOrNumber] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/machines/usage', {
        machineId: machine?.machineId,
        orNumber: orNumber.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['machines'] });
      toast.success('Loaded', machine?.name);
      setOrNumber('');
      onClose();
    },
    onError: (error) => toast.error('Could not start the load', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'Load ' + (machine?.name ?? '')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            icon={<Play className="h-4 w-4" aria-hidden="true" />}
            onClick={() => mutation.mutate()}
          >
            Start
          </Button>
        </>
      }
    >
      <Input
        label="O.R. number"
        hint="Optional — ties this load to an order so usage can be traced back to it."
        value={orNumber}
        onChange={(event) => setOrNumber(event.target.value)}
        placeholder="e.g. OR-001234"
        autoFocus
      />
    </Modal>
  );
}

export default function Machines() {
  useDocumentTitle('Machines');
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState<MachineDto | null>(null);

  const query = useQuery({
    queryKey: ['machines'],
    queryFn: ({ signal }) => api.get<{ items: MachineDto[] }>('/machines', undefined, signal),
    staleTime: 15_000,
  });

  const endUsage = useMutation({
    mutationFn: (usageId: string) => api.post('/machines/usage/' + usageId + '/end'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['machines'] });
      toast.success('Load finished');
    },
    onError: (error) => toast.error('Could not finish the load', errorMessage(error)),
  });

  const setStatus = useMutation({
    mutationFn: (input: { machineId: string; status: string }) =>
      api.patch('/machines/' + input.machineId, { status: input.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['machines'] });
      toast.success('Machine updated');
    },
    onError: (error) => toast.error('Could not update the machine', errorMessage(error)),
  });

  const machines = query.data?.items ?? [];
  const free = machines.filter((machine) => machine.status === 'Available').length;

  return (
    <>
      <PageHeader
        title="Machines"
        subtitle={
          query.data
            ? free + ' of ' + machines.length + ' free'
            : 'Washers and dryers, and what is in them.'
        }
        actions={
          can('machines.manage') ? (
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Add machine
            </Button>
          ) : null
        }
      />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState
            title="Could not load the machines"
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : machines.length === 0 ? (
        <Card>
          <EmptyState
            icon={<WashingMachine className="h-6 w-6" aria-hidden="true" />}
            title="No machines yet."
            message="Add the washers and dryers so loads can be tracked against them."
            action={
              can('machines.manage') ? (
                <Button onClick={() => setAddOpen(true)}>Add the first machine</Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {machines.map((machine) => (
            <Card
              key={machine.machineId}
              className={cn('border transition-colors', TONE[machine.status])}
            >
              <CardBody className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {machine.type === 'Dryer' ? (
                      <Wind className="h-5 w-5 shrink-0 text-navy-700" aria-hidden="true" />
                    ) : (
                      <WashingMachine className="h-5 w-5 shrink-0 text-navy-700" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-navy-900">{machine.name}</p>
                      <p className="text-xs text-slate-500">
                        {machine.type}
                        {machine.capacityKg > 0 ? ' · ' + machine.capacityKg + 'kg' : ''}
                      </p>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span className={cn('h-2 w-2 rounded-full', DOT[machine.status])} />
                    {machine.status}
                  </span>
                </div>

                <div className="mt-3 min-h-[2.5rem] text-sm">
                  {machine.currentUsage ? (
                    <p className="text-navy-800">
                      {machine.currentUsage.orNumber ? (
                        <span className="font-medium">{machine.currentUsage.orNumber}</span>
                      ) : (
                        <span className="text-slate-500">No order attached</span>
                      )}
                      <span className="text-slate-500">
                        {' · '}
                        {runningFor(machine.currentUsage.startedAt)}
                      </span>
                    </p>
                  ) : (
                    <p className="text-slate-500 tnum">{machine.totalCycles} cycles to date</p>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {machine.currentUsage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      loading={endUsage.isPending}
                      icon={<Square className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => endUsage.mutate(machine.currentUsage!.usageId)}
                    >
                      Take out
                    </Button>
                  ) : machine.status === 'Available' && can('machines.assign') ? (
                    <Button
                      size="sm"
                      className="flex-1"
                      icon={<Play className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => setLoading(machine)}
                    >
                      Load
                    </Button>
                  ) : null}

                  {can('machines.manage') && !machine.currentUsage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Wrench className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => {
                        void (async () => {
                          const next =
                            machine.status === 'Maintenance' ? 'Available' : 'Maintenance';
                          const ok = await confirm({
                            title:
                              next === 'Maintenance'
                                ? 'Take ' + machine.name + ' out of service?'
                                : 'Put ' + machine.name + ' back in service?',
                            confirmLabel: next === 'Maintenance' ? 'Take out' : 'Put back',
                            message:
                              next === 'Maintenance'
                                ? 'It will stop being offered for new loads until you put it back.'
                                : 'It will be offered for new loads again.',
                          });
                          if (ok) setStatus.mutate({ machineId: machine.machineId, status: next });
                        })();
                      }}
                    >
                      {machine.status === 'Maintenance' ? 'Back in' : 'Service'}
                    </Button>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {machines.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Why this matters"
            subtitle="Dryer cycles are what a gas tank's cost gets divided by, so taking loads out matters as much as putting them in."
          />
        </Card>
      ) : null}

      {confirmDialog}
      <AddMachineDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <LoadDialog machine={loading} open={Boolean(loading)} onClose={() => setLoading(null)} />
    </>
  );
}
