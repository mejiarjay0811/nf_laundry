import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Banknote,
  Check,
  ChevronDown,
  Minus,
  Plus,
  ReceiptText as ReceiptIcon,
  ReceiptText,
  Shirt,
  Smartphone,
  Sparkles,
  SplitSquareHorizontal,
  Tag,
  UserRound,
  Wind,
} from 'lucide-react';
import { computeTransactionMoney } from '@shared/calc';
import { toCentavos, toPesos } from '@shared/money';
import type {
  CreateTransactionResponse,
  CustomerDto,
  PaymentLine,
  ServiceDto,
  TransactionDto,
} from '@shared/types';
import { Clock } from '@/components/Clock';
import type { TenderMode } from '@/components/PaymentEntry';
import { CustomerPicker, type NewCustomerDraft } from '@/components/CustomerPicker';
import { QuickActions } from '@/components/QuickActions';
import { OrNumberField } from '@/components/OrNumberField';
import { ReceiptModal } from '@/components/ReceiptModal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiError, api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';
import { invalidateTransactionData } from '@/lib/queryClient';

const QUICK_QUANTITIES = [1, 2, 3, 4, 5, 6];

interface ServiceTile {
  bg: string;
  hover: string;
}

/**
 * The colours the service tiles cycle through.
 *
 * Assigned by position rather than by name, so a service keeps its colour for
 * as long as the price list keeps its order — which is what lets a cashier
 * reach for "the blue one" without reading it. Saturated and flat on purpose:
 * this is a till, not a brochure.
 */
/** How the money arrives. Split covers part cash, part GCash on one bill. */
const TENDER_MODES: Array<{ id: TenderMode; label: string; icon: typeof Banknote }> = [
  { id: 'Cash', label: 'Cash', icon: Banknote },
  { id: 'GCash', label: 'GCash', icon: Smartphone },
  { id: 'Split', label: 'Split', icon: SplitSquareHorizontal },
];

const SERVICE_TILES: ServiceTile[] = [
  { bg: 'bg-blue-600', hover: 'hover:bg-blue-700' },
  { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700' },
  { bg: 'bg-amber-500', hover: 'hover:bg-amber-600' },
  { bg: 'bg-violet-600', hover: 'hover:bg-violet-700' },
  { bg: 'bg-rose-500', hover: 'hover:bg-rose-600' },
  { bg: 'bg-cyan-600', hover: 'hover:bg-cyan-700' },
];

/** Service icons, matched on name so a renamed service still gets something. */
function serviceIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('dry') && !lower.includes('wash')) return Wind;
  if (lower.includes('wash') && lower.includes('dry')) return Sparkles;
  return Shirt;
}

function Section({
  step,
  title,
  icon,
  children,
  action,
}: {
  step: number;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    // Deliberately NOT overflow-hidden: the address autocomplete inside this
    // card is absolutely positioned and was being clipped by it.
    <section className="card">
      <header className="flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-navy-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            {icon}
          </span>
          <span className="text-slate-400 tnum">{step}</span>
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function Pos() {
  useDocumentTitle('Point of Sale');
  const toast = useToast();
  const { user, isAdmin } = useAuth();

  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [draft, setDraft] = useState<NewCustomerDraft | null>(null);
  const [orNumber, setOrNumber] = useState('');
  const [orTaken, setOrTaken] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [discount, setDiscount] = useState('');
  const [additionalCharge, setAdditionalCharge] = useState('');
  const [notes, setNotes] = useState('');
  /**
   * The method is chosen before the amount.
   *
   * With a Cash box and a GCash box both always present, an amount left in
   * the one you are not using still counts — which recorded cash that never
   * entered the drawer. Only the chosen method's fields exist, so the amounts
   * below are gated on it rather than merely hidden.
   */
  const [tenderMode, setTenderMode] = useState<TenderMode>('Cash');
  const [cash, setCash] = useState('');
  const [gcash, setGcash] = useState('');
  const [gcashReference, setGcashReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<TransactionDto | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /**
   * One idempotency key per attempt, regenerated only after a successful save,
   * so a retry after a network wobble replays the same sale rather than
   * creating a second one.
   */
  const idempotencyKey = useRef(newIdempotencyKey());

  const { data: services, isLoading: servicesLoading } = useQuery({
    queryKey: ['services'],
    queryFn: ({ signal }) => api.get<{ items: ServiceDto[] }>('/services', undefined, signal),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });

  useEffect(() => {
    if (!serviceId && services?.length) setServiceId(services[0]?.serviceId ?? '');
  }, [services, serviceId]);

  const service = useMemo(
    () => services?.find((item) => item.serviceId === serviceId) ?? null,
    [services, serviceId],
  );

  const cashC = tenderMode === 'GCash' ? 0 : toCentavos(cash || 0);
  const gcashC = tenderMode === 'Cash' ? 0 : toCentavos(gcash || 0);
  const tenderedC = cashC + gcashC;

  /** Carry the amount across when the method changes; never leave a copy. */
  const changeTenderMode = (next: TenderMode) => {
    const carried = toCentavos(cash || 0) + toCentavos(gcash || 0);
    const amount = carried > 0 ? toPesos(carried).toFixed(2) : '';
    if (next === 'Cash') {
      setCash(amount);
      setGcash('');
    } else if (next === 'GCash') {
      setGcash(amount);
      setCash('');
    }
    setTenderMode(next);
  };

  // Same arithmetic the server will apply, so what the cashier reads out is
  // what gets stored.
  const money = useMemo(
    () =>
      computeTransactionMoney({
        unitPrice: toCentavos(service?.price ?? 0),
        quantity,
        discount: toCentavos(discount || 0),
        additionalCharge: toCentavos(additionalCharge || 0),
        paidAmount: tenderedC,
      }),
    [service, quantity, discount, additionalCharge, tenderedC],
  );

  const hasAdjustments = toCentavos(discount || 0) > 0 || toCentavos(additionalCharge || 0) > 0;

  const reset = () => {
    setCustomer(null);
    setDraft(null);
    setOrNumber('');
    setOrTaken(false);
    setQuantity(1);
    setDiscount('');
    setAdditionalCharge('');
    setNotes('');
    setCash('');
    setGcash('');
    setGcashReference('');
    setShowAdjustments(false);
    setErrors({});
    idempotencyKey.current = newIdempotencyKey();
  };

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<CreateTransactionResponse>('/transactions', payload),
    onSuccess: (result) => {
      invalidateTransactionData();
      if (result.replayed) {
        toast.info('This sale was already saved.', 'Showing the original transaction.');
      } else {
        toast.success(
          'Saved · ' + result.transaction.orNumber,
          peso(result.transaction.totalPayment) +
            (result.change > 0 ? ' · change ' + peso(result.change) : ''),
        );
      }
      setReceipt(result.transaction);
      reset();
    },
    onError: (error) => {
      // A same-name customer with no number is a warning, not a wall: the
      // cashier can confirm it really is a different person.
      if (
        error instanceof ApiError &&
        (error.details as { overridable?: boolean } | undefined)?.overridable
      ) {
        setDuplicatePrompt(error.message);
        return;
      }
      toast.error('Unable to save transaction', errorMessage(error));
    },
  });

  const buildPayload = (allowDuplicateName?: boolean) => {
    const payments: PaymentLine[] = [];
    if (cashC > 0) payments.push({ modeOfPayment: 'Cash', amount: toPesos(cashC) });
    if (gcashC > 0) {
      payments.push({
        modeOfPayment: 'GCash',
        amount: toPesos(gcashC),
        ...(gcashReference.trim() ? { referenceNumber: gcashReference.trim() } : {}),
      });
    }

    return {
      ...(customer ? { customerId: customer.customerId } : {}),
      ...(draft
        ? {
            newCustomer: {
              fullName: draft.fullName.trim(),
              ...(draft.contactNumber.trim()
                ? { contactNumber: draft.contactNumber.trim() }
                : {}),
              ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
              ...(allowDuplicateName ? { allowDuplicateName: true } : {}),
            },
          }
        : {}),
      orNumber: orNumber.trim().toUpperCase(),
      serviceId,
      quantity,
      discount: toPesos(toCentavos(discount || 0)),
      additionalCharge: toPesos(toCentavos(additionalCharge || 0)),
      payments,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      idempotencyKey: idempotencyKey.current,
    };
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!customer && !draft) next.customer = 'Select a customer or register a new one.';
    if (draft && draft.fullName.trim().length < 2) next.fullName = 'Enter the customer name.';
    if (draft && draft.contactNumber.trim() && draft.contactNumber.replace(/\D/g, '').length < 7) {
      next.contactNumber = 'Enter a valid number, or leave it blank.';
    }
    if (!orNumber.trim()) next.orNumber = 'Enter the O.R. number from the receipt.';
    else if (orTaken) next.orNumber = 'That O.R. number has already been used.';
    if (!serviceId) next.service = 'Select a service.';
    if (money.change > 0 && cashC === 0) {
      next.payment = 'GCash cannot give change. Check the amounts.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /*
   * Saving is a two-step: check the form, then show what is about to be
   * recorded. A sale carries an O.R. number from a paper receipt book and money
   * that has already changed hands, so the last chance to catch a mistyped
   * amount is worth a tap.
   */
  const submit = () => {
    if (mutation.isPending) return;
    if (!validate()) {
      toast.warning('Check the highlighted fields.');
      return;
    }
    setConfirming(true);
  };

  const confirmAndSave = () => {
    setConfirming(false);
    mutation.mutate(buildPayload());
  };

  const customerName = customer?.fullName ?? draft?.fullName.trim() ?? '';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-navy-900 sm:text-2xl">
            Point of Sale
          </h1>
          {/* Whose till this is, and the shop clock — both go on the receipt
              book by hand, so both belong on the screen. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {user ? (
              <span className="flex items-center gap-1.5 text-sm text-slate-600">
                <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span className="font-medium text-navy-800">{user.fullName}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">{user.role}</span>
              </span>
            ) : null}
            <Clock />
          </div>
        </div>
        {/* Desktop only: on a phone the pinned till bar already carries the
            total, and two copies on one screen is just noise. */}
        {money.total > 0 ? (
          <span className="hidden rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-bold text-white tnum md:inline-block">
            {peso(toPesos(money.total))}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <Section
            step={1}
            title="Receipt"
            icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />}
          >
            <OrNumberField
              value={orNumber}
              onChange={(value) => {
                setOrNumber(value);
                setErrors((current) => ({ ...current, orNumber: '' }));
              }}
              onAvailabilityChange={setOrTaken}
              error={errors.orNumber}
              disabled={mutation.isPending}
            />
          </Section>

          <Section step={2} title="Customer" icon={<UserRound className="h-4 w-4" aria-hidden="true" />}>
            <CustomerPicker
              selected={customer}
              onSelect={(value) => {
                setCustomer(value);
                setErrors((current) => ({ ...current, customer: '' }));
              }}
              draft={draft}
              onDraftChange={setDraft}
              errors={errors}
              disabled={mutation.isPending}
            />
          </Section>

          <Section step={3} title="Service" icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
            {servicesLoading ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
              </div>
            ) : services?.length ? (
              /*
               * Big flat colour tiles, the way a till in a fast-food counter or
               * a supermarket does it. A cashier picks these by colour and
               * position long before they read the label, so each service keeps
               * the same colour every time and the target is large enough to hit
               * without looking.
               */
              <div
                role="radiogroup"
                aria-label="Service"
                className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
              >
                {services.map((item, index) => {
                  const active = item.serviceId === serviceId;
                  const Icon = serviceIcon(item.name);
                  const tile = SERVICE_TILES[index % SERVICE_TILES.length] as ServiceTile;
                  return (
                    <button
                      key={item.serviceId}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={mutation.isPending}
                      onClick={() => setServiceId(item.serviceId)}
                      className={cn(
                        'relative flex min-h-[104px] flex-col justify-between rounded-xl p-3 text-left',
                        'transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
                        tile.bg,
                        tile.hover,
                        active
                          ? 'ring-4 ring-navy-900 ring-offset-1'
                          : 'ring-1 ring-black/10',
                      )}
                    >
                      <span className="flex items-start justify-between">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/25">
                          <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                        </span>
                        {active ? (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                            <Check className="h-4 w-4 text-navy-900" aria-hidden="true" />
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2 block">
                        <span className="block text-sm font-semibold leading-tight text-white">
                          {item.name}
                        </span>
                        <span className="block text-xl font-extrabold text-white tnum">
                          {peso(item.price)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                No active services are configured. An administrator must add one in Services.
              </p>
            )}

            <div className="mt-4">
              <span className="label" id="quantity-label">
                Quantity
              </span>
              <div className="flex flex-wrap items-center gap-2" aria-labelledby="quantity-label">
                <Button
                  variant="outline"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  disabled={quantity <= 1 || mutation.isPending}
                  aria-label="Decrease quantity"
                  className="h-12 w-12 shrink-0 px-0"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  value={quantity}
                  aria-label="Quantity"
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setQuantity(Number.isFinite(next) ? Math.min(999, Math.max(1, next)) : 1);
                  }}
                  disabled={mutation.isPending}
                  className="h-12 w-20 rounded-xl border border-slate-300 text-center text-xl font-bold tnum focus:border-brand-500"
                />
                <Button
                  variant="outline"
                  onClick={() => setQuantity((value) => Math.min(999, value + 1))}
                  disabled={mutation.isPending}
                  aria-label="Increase quantity"
                  className="h-12 w-12 shrink-0 px-0"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>

                {/* A keypad rather than a row of small chips: on a counter
                    screen these are hit with a thumb, not a mouse. */}
                <div className="grid w-full grid-cols-6 gap-1.5 sm:ml-2 sm:w-auto">
                  {QUICK_QUANTITIES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuantity(value)}
                      disabled={mutation.isPending}
                      className={cn(
                        'h-12 rounded-lg text-base font-bold tnum transition-transform active:scale-95 sm:w-12',
                        quantity === value
                          ? 'bg-navy-900 text-white ring-2 ring-navy-900'
                          : 'bg-slate-100 text-navy-800 hover:bg-slate-200',
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* Adjustments stay out of the way until they are actually needed —
              most sales have neither a discount nor an extra charge. */}
          <section className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdjustments((open) => !open)}
              aria-expanded={showAdjustments}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="flex items-center gap-2.5 text-sm font-semibold text-navy-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Tag className="h-4 w-4" aria-hidden="true" />
                </span>
                Discount or extra charge
                {hasAdjustments ? (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">
                    Applied
                  </span>
                ) : (
                  <span className="text-xs font-normal text-slate-400">Optional</span>
                )}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-slate-400 transition-transform',
                  showAdjustments && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>

            {showAdjustments ? (
              <div className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
                <Input
                  label="Discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                  leading={<span className="text-sm">{'₱'}</span>}
                  placeholder="0.00"
                  disabled={mutation.isPending}
                />
                <Input
                  label="Additional charge"
                  inputMode="decimal"
                  value={additionalCharge}
                  onChange={(event) => setAdditionalCharge(event.target.value)}
                  leading={<span className="text-sm">{'₱'}</span>}
                  placeholder="0.00"
                  disabled={mutation.isPending}
                />
                <Textarea
                  label="Notes"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Special instructions, garment notes"
                  containerClassName="sm:col-span-2"
                  disabled={mutation.isPending}
                />
              </div>
            ) : null}
          </section>
        </div>

        {/* Payment panel. Sticky on desktop; the natural last block on mobile. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <section className="card overflow-hidden">
            <header className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-navy-900">Payment</h2>
            </header>

            <div className="space-y-1 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-600">
                  {service?.name ?? 'Service'} {'×'} {quantity}
                </span>
                <span className="font-medium tnum">{peso(toPesos(money.subtotal))}</span>
              </div>
              {money.discount > 0 ? (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-600">Discount</span>
                  <span className="font-medium text-emerald-700 tnum">
                    -{peso(toPesos(money.discount))}
                  </span>
                </div>
              ) : null}
              {money.additionalCharge > 0 ? (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-600">Additional charge</span>
                  <span className="font-medium tnum">{peso(toPesos(money.additionalCharge))}</span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                <span className="font-semibold text-navy-900">Total</span>
                <span className="text-xl font-bold text-navy-900 tnum">
                  {peso(toPesos(money.total))}
                </span>
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div
                role="radiogroup"
                aria-label="Mode of payment"
                className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1"
              >
                {TENDER_MODES.map((entry) => {
                  const Icon = entry.icon;
                  const active = tenderMode === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={mutation.isPending}
                      onClick={() => changeTenderMode(entry.id)}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-semibold transition-all',
                        active
                          ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-600 active:bg-white/60',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {entry.label}
                    </button>
                  );
                })}
              </div>

              {tenderMode !== 'GCash' ? (
                <>
                  <Input
                    id="pos-cash"
                    label={tenderMode === 'Split' ? 'Cash portion' : 'Cash received'}
                    type="text"
                    inputMode="decimal"
                    value={cash}
                    onChange={(event) => setCash(event.target.value)}
                    leading={<Banknote className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
                    placeholder="0.00"
                    disabled={mutation.isPending}
                    className="h-12 text-lg font-bold tnum"
                  />

                  {/* Note keys, like the denomination buttons on a real till. */}
                  <div className="grid grid-cols-5 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCash(toPesos(Math.max(0, money.total - gcashC)).toFixed(2))}
                      disabled={mutation.isPending || money.total <= 0}
                      className="h-11 rounded-lg bg-navy-900 text-xs font-bold uppercase tracking-wide text-white transition-transform active:scale-95 disabled:opacity-40"
                    >
                      Exact
                    </button>
                    {[100, 200, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setCash(String(amount))}
                        disabled={mutation.isPending}
                        className="h-11 rounded-lg bg-emerald-100 text-sm font-bold text-emerald-800 transition-transform active:scale-95 tnum"
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {tenderMode !== 'Cash' ? (
                <>
                  <Input
                    id="pos-gcash"
                    label={tenderMode === 'Split' ? 'GCash portion' : 'GCash amount'}
                    type="text"
                    inputMode="decimal"
                    value={gcash}
                    onChange={(event) => setGcash(event.target.value)}
                    leading={<Smartphone className="h-4 w-4 text-brand-600" aria-hidden="true" />}
                    placeholder="0.00"
                    disabled={mutation.isPending}
                    className="h-12 text-lg font-bold tnum"
                  />
                  {tenderMode === 'GCash' ? (
                    <button
                      type="button"
                      onClick={() => setGcash(toPesos(money.total).toFixed(2))}
                      disabled={mutation.isPending || money.total <= 0}
                      className="h-11 w-full rounded-lg bg-navy-900 text-xs font-bold uppercase tracking-wide text-white transition-transform active:scale-95 disabled:opacity-40"
                    >
                      Exact {'·'} {peso(toPesos(money.total))}
                    </button>
                  ) : null}
                  <Input
                    label="GCash reference"
                    value={gcashReference}
                    onChange={(event) => setGcashReference(event.target.value)}
                    hint="Optional"
                    disabled={mutation.isPending}
                  />
                </>
              ) : null}

              {errors.payment ? (
                <p className="rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-700" role="alert">
                  {errors.payment}
                </p>
              ) : null}

              <div className="space-y-1 rounded-xl bg-slate-50 p-3">
                {tenderedC > 0 ? (
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-600">Tendered</span>
                    <span className="font-medium tnum">{peso(toPesos(tenderedC))}</span>
                  </div>
                ) : null}
                {money.change > 0 ? (
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-navy-900">Change</span>
                    <span className="text-lg font-bold text-emerald-700 tnum">
                      {peso(toPesos(money.change))}
                    </span>
                  </div>
                ) : null}
                {money.balance > 0 ? (
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-navy-900">Balance due</span>
                    <span className="text-lg font-bold text-red-600 tnum">
                      {peso(toPesos(money.balance))}
                    </span>
                  </div>
                ) : null}
                {tenderedC > 0 && money.change === 0 && money.balance === 0 ? (
                  <p className="text-center text-sm font-medium text-emerald-700">
                    Exact payment {'·'} fully settled
                  </p>
                ) : null}
                {tenderedC === 0 ? (
                  <p className="text-center text-sm text-slate-500">
                    Leave blank to record an unpaid order
                  </p>
                ) : null}
              </div>

              {/*
                The one button that matters, sized to say so.
                Hidden on a phone, where the same action is pinned to the
                bottom of the screen instead — see the bar below. Two copies
                stacked would be the same button twice in one scroll.
              */}
              <button
                type="button"
                onClick={submit}
                disabled={!service || mutation.isPending}
                className={cn(
                  'hidden h-16 w-full items-center justify-center gap-2.5 rounded-xl md:flex',
                  'bg-emerald-600 text-lg font-bold text-white shadow-sm',
                  'transition-transform hover:bg-emerald-700 active:scale-[0.98]',
                  'disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500',
                )}
              >
                <ReceiptIcon className="h-5 w-5" aria-hidden="true" />
                {mutation.isPending ? 'Saving…' : 'Complete Sale'}
                {money.total > 0 && !mutation.isPending ? (
                  <span className="tnum">{'· ' + peso(toPesos(money.total))}</span>
                ) : null}
              </button>
            </div>
          </section>

          {/* Directly under the sale button, where the hand already is once a
              transaction is finished — an owner working the counter can move
              straight on to whatever is next without going back to the menu. */}
          {isAdmin ? (
            <section className="card mt-3 p-4">
              <h2 className="mb-2 text-sm font-semibold text-navy-900">Quick actions</h2>
              <QuickActions role="Admin" columns={2} />
            </section>
          ) : null}

          {/* Room for the pinned till bar, so the last card is not stuck
              underneath it at the end of the scroll. */}
          <div aria-hidden="true" className="h-32 md:hidden" />
        </div>
      </div>

      {/*
        The till bar.

        On a phone the sale is a long form — receipt number, customer,
        service, quantity, then payment — and the button that finishes it used
        to sit at the very bottom of all of it. That meant scrolling past
        everything you had just filled in to press the one key that matters,
        on every single sale. Here it is pinned above the navigation instead,
        carrying the running total, so it is reachable from any point in the
        form and the cashier can always see what they are about to charge.
      */}
      <div
        className="fixed inset-x-0 z-30 border-t border-slate-200 bg-white/95 px-3 pb-2.5 pt-2 shadow-[0_-4px_20px_-8px_rgb(15_23_42/0.3)] backdrop-blur md:hidden no-print"
        /* Sits directly on top of the navigation rather than over it. */
        style={{ bottom: 'var(--app-nav-height)' }}
      >
        <div className="mb-1.5 flex items-baseline justify-between px-1">
          <span className="text-xs font-medium text-slate-500">
            {service?.name ?? 'No service'} {'×'} {quantity}
          </span>
          <span className="text-lg font-bold text-navy-900 tnum">
            {peso(toPesos(money.total))}
          </span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!service || mutation.isPending}
          className={cn(
            'flex h-14 w-full items-center justify-center gap-2 rounded-xl',
            'bg-emerald-600 text-base font-bold text-white shadow-sm',
            'transition-transform active:scale-[0.98]',
            'disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500',
          )}
        >
          <ReceiptIcon className="h-5 w-5" aria-hidden="true" />
          {mutation.isPending ? 'Saving…' : 'Complete Sale'}
          {money.change > 0 && !mutation.isPending ? (
            <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-xs tnum">
              change {peso(toPesos(money.change))}
            </span>
          ) : null}
        </button>
      </div>

      <ReceiptModal
        transaction={receipt}
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title="Sale saved"
      />

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={mutation.isPending}
        title="Confirm this sale"
        description={'O.R. ' + orNumber.trim().toUpperCase()}
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={mutation.isPending}
            >
              Go back
            </Button>
            <Button
              loading={mutation.isPending}
              onClick={confirmAndSave}
              icon={<Check className="h-4 w-4" aria-hidden="true" />}
            >
              Save sale
            </Button>
          </>
        }
      >
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Customer</dt>
            <dd className="text-right font-medium text-navy-900">
              {customerName}
              {draft ? <span className="ml-1 text-xs text-brand-700">(new)</span> : null}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Service</dt>
            <dd className="text-right font-medium text-navy-900">
              {service?.name} {'×'} {quantity}
            </dd>
          </div>
          {money.discount > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Discount</dt>
              <dd className="font-medium text-emerald-700 tnum">
                -{peso(toPesos(money.discount))}
              </dd>
            </div>
          ) : null}
          {money.additionalCharge > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Additional charge</dt>
              <dd className="font-medium tnum">{peso(toPesos(money.additionalCharge))}</dd>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2.5">
            <dt className="font-semibold text-navy-900">Total</dt>
            <dd className="text-xl font-bold text-navy-900 tnum">{peso(toPesos(money.total))}</dd>
          </div>

          {cashC > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="flex items-center gap-1.5 text-slate-600">
                <Banknote className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                Cash
              </dt>
              <dd className="font-medium tnum">{peso(toPesos(cashC))}</dd>
            </div>
          ) : null}
          {gcashC > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="flex items-center gap-1.5 text-slate-600">
                <Smartphone className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                GCash
              </dt>
              <dd className="font-medium tnum">{peso(toPesos(gcashC))}</dd>
            </div>
          ) : null}

          {money.change > 0 ? (
            <div className="flex items-baseline justify-between gap-4 rounded-lg bg-emerald-50 px-3 py-2">
              <dt className="font-semibold text-emerald-900">Change to hand back</dt>
              <dd className="text-lg font-bold text-emerald-700 tnum">
                {peso(toPesos(money.change))}
              </dd>
            </div>
          ) : null}

          {money.balance > 0 ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="font-semibold text-amber-900">Balance left unpaid</dt>
                <dd className="text-lg font-bold text-amber-800 tnum">
                  {peso(toPesos(money.balance))}
                </dd>
              </div>
              <p className="mt-1 text-xs text-amber-800">
                This will be saved as an unpaid order. It can be settled later from the
                order itself.
              </p>
            </div>
          ) : null}
        </dl>
      </Modal>

      <ConfirmDialog
        open={duplicatePrompt !== null}
        onClose={() => setDuplicatePrompt(null)}
        busy={mutation.isPending}
        title="Register anyway?"
        confirmLabel="Yes, different person"
        message={duplicatePrompt}
        onConfirm={() => {
          setDuplicatePrompt(null);
          mutation.mutate(buildPayload(true));
        }}
      />
    </>
  );
}
