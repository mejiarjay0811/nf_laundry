import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Minus,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  STOCK_MOVEMENTS,
  type InventoryCategory,
  type StockMovement,
} from '@shared/constants';
import type { InventoryItemDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

/** Everything that touched stock also has to refresh what it affects. */
function invalidateStock(): void {
  for (const key of ['inventory', 'expenses', 'profit', 'dashboard']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/* ------------------------------------------------------------- item form */

function ItemDialog({
  item,
  open,
  onClose,
}: {
  item: InventoryItemDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const editing = item !== null;

  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<string>(item?.category ?? 'Detergent');
  const [unit, setUnit] = useState(item?.unit ?? 'kg');
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : '0');
  const [unitCost, setUnitCost] = useState(item ? item.unitCost.toFixed(2) : '');
  const [reorderLevel, setReorderLevel] = useState(item ? String(item.reorderLevel) : '');
  const [supplier, setSupplier] = useState(item?.supplier ?? '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(item?.status ?? 'Active');
  const [recordExpense, setRecordExpense] = useState(true);

  // Opening stock that cost something is a purchase, so the admin is asked
  // whether it should also go in the books before the item is saved.
  const openingValue = editing ? 0 : (Number(quantity) || 0) * (Number(unitCost) || 0);

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) {
        return api.patch<{ item: InventoryItemDto }>('/inventory/' + item.itemId, body);
      }
      const created = await api.post<{ item: InventoryItemDto }>('/inventory', body);

      /*
       * Written after the item exists, so a rejected expense cannot leave a
       * half-made item behind. If this second call fails the item is still
       * saved and the admin is told the expense was not — which is recoverable
       * by hand, unlike the reverse.
       */
      if (openingValue > 0 && recordExpense) {
        await api.post('/expenses', {
          category: 'Supplies',
          description:
            'Opening stock: ' + String(body.name) + ' (' + Number(quantity) + ' ' + String(body.unit) + ')',
          amount: openingValue,
          modeOfPayment: 'Cash',
          reference: String(body.supplier ?? ''),
        });
      }
      return created;
    },
    onSuccess: () => {
      invalidateStock();
      toast.success(
        editing ? 'Item updated' : 'Item added',
        !editing && openingValue > 0 && recordExpense
          ? peso(openingValue) + ' recorded as a Supplies expense'
          : undefined,
      );
      onClose();
    },
    onError: (error) => toast.error('Unable to save the item', errorMessage(error)),
  });

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        busy={mutation.isPending}
        title={editing ? 'Edit item' : 'Add stock item'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={name.trim().length < 2}
              onClick={async () => {
                const ok = await confirm({
                  title: editing ? 'Save this item?' : 'Add this item?',
                  confirmLabel: editing ? 'Save changes' : 'Add item',
                  message: (
                    <>
                      <strong>{name.trim()}</strong> at{' '}
                      <strong>{peso(Number(unitCost) || 0)}</strong> per {unit}.
                      {!editing && Number(quantity) > 0 ? (
                        <span className="mt-2 block">
                          Opening stock: {Number(quantity)} {unit}.
                        </span>
                      ) : null}
                      {openingValue > 0 ? (
                        <span
                          className={cn(
                            'mt-2 block font-medium',
                            recordExpense ? 'text-amber-700' : 'text-slate-500',
                          )}
                        >
                          {recordExpense
                            ? peso(openingValue) + ' will also be recorded as a Supplies expense.'
                            : 'This will NOT be recorded as an expense.'}
                        </span>
                      ) : null}
                    </>
                  ),
                });
                if (!ok) return;
                mutation.mutate({
                  name: name.trim(),
                  category,
                  unit,
                  unitCost: Number(unitCost) || 0,
                  reorderLevel: Number(reorderLevel) || 0,
                  supplier: supplier.trim(),
                  ...(editing ? { status } : { quantity: Number(quantity) || 0 }),
                });
              }}
            >
              {editing ? 'Save changes' : 'Add item'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Item name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Powder detergent"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {INVENTORY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select label="Unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
              {INVENTORY_UNITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!editing ? (
              <Input
                label="Opening stock"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                hint="How much is on the shelf now"
              />
            ) : null}
            <Input
              label="Cost per unit"
              inputMode="decimal"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              leading={<span className="text-sm">{'₱'}</span>}
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Reorder level"
              inputMode="decimal"
              value={reorderLevel}
              onChange={(event) => setReorderLevel(event.target.value)}
              hint="Warn below this"
            />
            <Input
              label="Supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              hint="Optional"
            />
          </div>

          {openingValue > 0 ? (
            <label className="flex items-start gap-2.5 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
              <input
                type="checkbox"
                checked={recordExpense}
                onChange={(event) => setRecordExpense(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="font-medium text-amber-900">
                  Record {peso(openingValue)} as an expense
                </span>
                <span className="mt-0.5 block text-xs text-amber-800">
                  This opening stock has a value, so it was probably bought. Leave this
                  ticked to put it in the books as a Supplies expense; untick it if the
                  stock was already paid for or was counted rather than purchased.
                </span>
              </span>
            </label>
          ) : null}
          {editing ? (
            <Select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value as 'Active' | 'Inactive')}
              hint="Inactive items stay on record but are hidden"
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

/* ---------------------------------------------------------- stock moves */

function MovementDialog({
  item,
  mode,
  open,
  onClose,
}: {
  item: InventoryItemDto | null;
  mode: 'in' | 'out';
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [recordExpense, setRecordExpense] = useState(true);
  const [type, setType] = useState<StockMovement>('Used');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ item: InventoryItemDto; expenseId: string | null }>(
        '/inventory/' + item?.itemId + '/movements',
        body,
      ),
    onSuccess: (result) => {
      invalidateStock();
      toast.success(
        mode === 'in' ? 'Stock added' : 'Stock taken out',
        result.item.name + ' is now ' + result.item.quantity + ' ' + result.item.unit +
          (result.expenseId ? ' · recorded as an expense' : ''),
      );
      onClose();
    },
    onError: (error) => toast.error('Unable to update stock', errorMessage(error)),
  });

  if (!item) return null;

  const amount = Number(quantity) || 0;
  const cost = mode === 'in' ? (Number(unitCost) || item.unitCost) * amount : 0;
  const balanceAfter = mode === 'in' ? item.quantity + amount : item.quantity - amount;
  const wouldGoNegative = balanceAfter < 0;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        busy={mutation.isPending}
        title={mode === 'in' ? 'Add stock' : 'Take stock out'}
        description={item.name + ' · ' + item.quantity + ' ' + item.unit + ' on hand'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={amount <= 0 || wouldGoNegative}
              onClick={async () => {
                const ok = await confirm({
                  title: mode === 'in' ? 'Add this stock?' : 'Take this stock out?',
                  confirmLabel: mode === 'in' ? 'Add stock' : 'Take out',
                  message: (
                    <>
                      <strong>{item.name}</strong> goes from {item.quantity} to{' '}
                      <strong>
                        {balanceAfter} {item.unit}
                      </strong>
                      .
                      {mode === 'in' && recordExpense && cost > 0 ? (
                        <span className="mt-2 block font-medium text-amber-700">
                          {peso(cost)} will also be recorded as a Supplies expense.
                        </span>
                      ) : null}
                    </>
                  ),
                });
                if (!ok) return;
                mutation.mutate(
                  mode === 'in'
                    ? {
                        type: 'Restock',
                        quantity: amount,
                        ...(unitCost.trim() ? { unitCost: Number(unitCost) } : {}),
                        recordExpense,
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      }
                    : {
                        type,
                        quantity: amount,
                        ...(reason.trim() ? { reason: reason.trim() } : {}),
                      },
                );
              }}
            >
              {mode === 'in' ? 'Add stock' : 'Take out'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {mode === 'out' ? (
            <Select
              label="Reason"
              value={type}
              onChange={(event) => setType(event.target.value as StockMovement)}
            >
              {STOCK_MOVEMENTS.filter((value) => value !== 'Restock').map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          ) : null}

          <Input
            label={'Quantity (' + item.unit + ')'}
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="0"
            className="text-lg font-semibold tnum"
            autoFocus
            error={wouldGoNegative ? 'There is only ' + item.quantity + ' ' + item.unit + ' on hand.' : ''}
          />

          {mode === 'in' ? (
            <>
              <Input
                label="Cost per unit"
                inputMode="decimal"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                leading={<span className="text-sm">{'₱'}</span>}
                placeholder={item.unitCost.toFixed(2)}
                hint="Leave blank to keep the current cost"
              />
              <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={recordExpense}
                  onChange={(event) => setRecordExpense(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span>
                  <span className="font-medium text-navy-900">Record this as an expense</span>
                  <span className="mt-0.5 block text-xs text-slate-600">
                    Adds {peso(cost)} to Supplies, so the purchase appears in the month's
                    spending without entering it twice.
                  </span>
                </span>
              </label>
            </>
          ) : null}

          <Textarea
            label="Note"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={mode === 'in' ? 'Delivery reference' : 'What it was used for'}
          />

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Balance after</span>
              <span
                className={cn('font-semibold tnum', wouldGoNegative ? 'text-red-600' : 'text-navy-900')}
              >
                {balanceAfter} {item.unit}
              </span>
            </div>
          </div>
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}

/* -------------------------------------------------------------- screen */

export default function Inventory() {
  useDocumentTitle('Inventory');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [editing, setEditing] = useState<InventoryItemDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [movement, setMovement] = useState<{ item: InventoryItemDto; mode: 'in' | 'out' } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['inventory', { category, lowStockOnly }],
    queryFn: ({ signal }) =>
      api.get<{ items: InventoryItemDto[] }>(
        '/inventory',
        { category: category || undefined, lowStockOnly: lowStockOnly || undefined },
        signal,
      ),
    // Keep the previous rows on screen while a filter change is fetched, so
    // the table dims rather than disappearing.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const needle = search.trim().toLowerCase();
  const items = (query.data?.items ?? []).filter(
    (item) =>
      !needle ||
      (item.name + ' ' + item.category + ' ' + item.supplier).toLowerCase().includes(needle),
  );

  const lowCount = (query.data?.items ?? []).filter((item) => item.lowStock).length;
  const stockValue = (query.data?.items ?? []).reduce((sum, item) => sum + item.stockValue, 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Detergent, conditioner and everything else the shop keeps in stock."
        actions={
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Add item
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card>
          <CardBody className="py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Items</p>
            <p className="mt-1 text-2xl font-bold text-navy-900 tnum">
              {query.data?.items.length ?? 0}
            </p>
          </CardBody>
        </Card>
        <Card className={lowCount > 0 ? 'ring-1 ring-amber-300' : undefined}>
          <CardBody className="py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Needs reorder
            </p>
            <p
              className={cn(
                'mt-1 text-2xl font-bold tnum',
                lowCount > 0 ? 'text-amber-600' : 'text-navy-900',
              )}
            >
              {lowCount}
            </p>
          </CardBody>
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <CardBody className="py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Value on the shelf
            </p>
            <p className="mt-1 text-2xl font-bold text-navy-900 tnum">{peso(stockValue)}</p>
          </CardBody>
        </Card>
      </div>

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
              placeholder="Search item or supplier"
              aria-label="Search inventory"
              className="h-11 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
            className="h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500"
          >
            <option value="">All categories</option>
            {INVENTORY_CATEGORIES.map((value: InventoryCategory) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-pressed={lowStockOnly}
            onClick={() => setLowStockOnly((value) => !value)}
            className={cn(
              'h-11 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors',
              lowStockOnly
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            Needs reorder{lowCount > 0 ? ' (' + lowCount + ')' : ''}
          </button>
        </div>
      </div>

      <Card>
        <CardHeader title="Stock on hand" subtitle={items.length + ' items'} />
        {query.isLoading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load the inventory"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" aria-hidden="true" />}
            title="Nothing recorded yet."
            message="Add the soap, conditioner and supplies the shop buys, and their stock will be tracked here."
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Add the first item
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Category</Th>
                    <Th align="right">On hand</Th>
                    <Th align="right">Unit cost</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">{''}</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <Tr key={item.itemId}>
                      <Td>
                        <span className="font-medium text-navy-900">{item.name}</span>
                        {item.supplier ? (
                          <span className="block text-xs text-slate-500">{item.supplier}</span>
                        ) : null}
                      </Td>
                      <Td className="text-slate-600">{item.category}</Td>
                      <Td align="right">
                        <span
                          className={cn(
                            'font-semibold tnum',
                            item.lowStock ? 'text-amber-600' : 'text-navy-900',
                          )}
                        >
                          {item.quantity} {item.unit}
                        </span>
                        {item.lowStock ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Low
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="text-slate-600">
                        {peso(item.unitCost)}
                      </Td>
                      <Td align="right" className="font-medium">
                        {peso(item.stockValue)}
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setMovement({ item, mode: 'in' })}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => setMovement({ item, mode: 'out' })}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-navy-700 hover:bg-slate-50"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            Use
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(item)}
                            aria-label={'Edit ' + item.name}
                            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="divide-y divide-slate-100 sm:hidden">
              {items.map((item) => (
                <li key={item.itemId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-navy-900">{item.name}</p>
                      <p className="text-xs text-slate-500">
                        {item.category} {'·'} {peso(item.unitCost)} per {item.unit}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-sm font-bold tnum',
                        item.lowStock ? 'text-amber-600' : 'text-navy-900',
                      )}
                    >
                      {item.quantity} {item.unit}
                    </span>
                  </div>
                  {item.lowStock ? (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      At or below the reorder level of {item.reorderLevel}
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      className="flex-1"
                      onClick={() => setMovement({ item, mode: 'in' })}
                      icon={<PackagePlus className="h-4 w-4" aria-hidden="true" />}
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setMovement({ item, mode: 'out' })}
                      icon={<Minus className="h-4 w-4" aria-hidden="true" />}
                    >
                      Use
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {adding ? <ItemDialog item={null} open onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <ItemDialog key={editing.itemId} item={editing} open onClose={() => setEditing(null)} />
      ) : null}
      {movement ? (
        <MovementDialog
          key={movement.item.itemId + movement.mode}
          item={movement.item}
          mode={movement.mode}
          open
          onClose={() => setMovement(null)}
        />
      ) : null}
    </>
  );
}
