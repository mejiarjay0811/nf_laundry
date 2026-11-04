import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Sparkles } from 'lucide-react';
import type { ServiceDto } from '@shared/types';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

function ServiceDialog({
  service,
  open,
  onClose,
}: {
  service: ServiceDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const editing = service !== null;

  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState(service ? service.price.toFixed(2) : '');
  const [unit, setUnit] = useState(service?.unit ?? 'load');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(service?.status ?? 'Active');

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<{ service: ServiceDto }>('/services/' + service.serviceId, body)
        : api.post<{ service: ServiceDto }>('/services', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success(editing ? 'Service updated' : 'Service added');
      onClose();
    },
    onError: (error) => toast.error('Unable to save service', errorMessage(error)),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title={editing ? 'Edit service' : 'Add service'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={name.trim().length < 2 || !(Number(price) > 0)}
            onClick={async () => {
              // The price is what every future sale is rung up at, so a change
              // here is worth reading back before it is saved.
              const ok = await confirm({
                title: editing ? 'Save this service?' : 'Add this service?',
                confirmLabel: editing ? 'Save changes' : 'Add service',
                message: (
                  <>
                    <strong>{name.trim()}</strong> will be charged at{' '}
                    <strong>{peso(Number(price))}</strong> per {unit.trim() || 'load'}.
                    {editing && service && Number(price) !== service.price ? (
                      <span className="mt-2 block font-medium text-amber-700">
                        The price changes from {peso(service.price)} to {peso(Number(price))}.
                        Existing orders keep the price they were rung up at.
                      </span>
                    ) : null}
                    {editing && status === 'Inactive' ? (
                      <span className="mt-2 block font-medium text-amber-700">
                        It will no longer be offered on new sales.
                      </span>
                    ) : null}
                  </>
                ),
              });
              if (ok) {
                mutation.mutate({
                  name: name.trim(),
                  description: description.trim(),
                  price: Number(price),
                  unit: unit.trim() || 'load',
                  ...(editing ? { status } : {}),
                });
              }
            }}
          >
            {editing ? 'Save changes' : 'Add service'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-brand-50 p-3 text-xs text-brand-900">
          Price changes apply to <strong>new transactions only</strong>. Existing receipts keep the
          price that was actually charged.
        </div>
        <Input
          label="Service name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
          disabled={mutation.isPending}
        />
        <Input
          label="Price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          leading={<span className="text-sm">{'\u20B1'}</span>}
          required
          disabled={mutation.isPending}
        />
        <Input
          label="Unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          hint="e.g. load, kilo, piece"
          disabled={mutation.isPending}
        />
        <Textarea
          label="Description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={mutation.isPending}
        />
        {editing ? (
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as 'Active' | 'Inactive')}
            hint="Inactive services cannot be sold, but past sales are unaffected."
            disabled={mutation.isPending}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        ) : null}
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}

export default function Services() {
  useDocumentTitle('Services');
  const { can } = useAuth();
  const isAdmin = can('services.manage');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);

  const query = useQuery({
    queryKey: ['services', { includeInactive: isAdmin }],
    queryFn: ({ signal }) =>
      api.get<{ items: ServiceDto[] }>(
        '/services',
        isAdmin ? { includeInactive: true } : undefined,
        signal,
      ),
    staleTime: 60_000,
  });

  const items = query.data?.items ?? [];

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (service: ServiceDto) => {
    setEditing(service);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="The single source of pricing for every new sale."
        actions={
          isAdmin ? (
            <Button size="sm" onClick={openNew} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
              Add service
            </Button>
          ) : null
        }
      />

      {!isAdmin ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            You can see current prices here. Only an administrator can change them.
          </span>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {query.isLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load services"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" aria-hidden="true" />}
            title="No services configured."
            message="Add a service so the POS has something to sell."
            action={
              isAdmin ? (
                <Button size="sm" onClick={openNew}>
                  Add service
                </Button>
              ) : null
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Service</Th>
                <Th align="right">Price</Th>
                <Th>Unit</Th>
                <Th>Status</Th>
                {isAdmin ? <Th align="right">Actions</Th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((service) => (
                <Tr key={service.serviceId}>
                  <Td>
                    <span className="block font-medium text-navy-900">{service.name}</span>
                    {service.description ? (
                      <span className="block text-xs text-slate-500">{service.description}</span>
                    ) : null}
                  </Td>
                  <Td align="right" className="text-base font-bold">
                    {peso(service.price)}
                  </Td>
                  <Td className="text-slate-600">per {service.unit}</Td>
                  <Td>
                    <Badge tone={service.status === 'Active' ? 'green' : 'slate'}>
                      {service.status}
                    </Badge>
                  </Td>
                  {isAdmin ? (
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(service)}
                        icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        Edit
                      </Button>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {dialogOpen ? (
        <ServiceDialog
          key={editing?.serviceId ?? 'new'}
          service={editing}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}
