import { useEffect, useMemo, useState } from 'react';
import { Banknote, Smartphone, SplitSquareHorizontal } from 'lucide-react';
import type { PaymentMode } from '@shared/constants';
import { toCentavos, toPesos } from '@shared/money';
import { Input } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';

export type TenderMode = 'Cash' | 'GCash' | 'Split';

export interface PaymentLine {
  modeOfPayment: PaymentMode;
  amount: number;
  referenceNumber?: string;
}

export interface TenderState {
  mode: TenderMode;
  cashC: number;
  gcashC: number;
  tenderedC: number;
  appliedC: number;
  changeC: number;
  remainingC: number;
  lines: PaymentLine[];
  /** Why this cannot be submitted, or null when it can. */
  problem: string | null;
}

/**
 * Taking money, with the method chosen first.
 *
 * The previous design put a Cash box and a GCash box side by side and
 * pre-filled Cash with the amount due. That quietly produced wrong ledgers:
 * to settle a bill by GCash the cashier typed the amount into GCash, the
 * pre-filled Cash was still sitting there, and the sale was recorded as cash
 * AND GCash — double the money, with change owed on a payment nobody handed
 * over. Cash that never entered the drawer then made every shift count short.
 *
 * Picking the method first makes that state unreachable: only the fields for
 * the chosen method exist, and switching method moves the amount rather than
 * leaving a copy behind. Split is still one tap away, because half cash and
 * half GCash on one bill is routine here.
 */
export function useTender(dueC: number, open: boolean): [TenderState, TenderControls] {
  const [mode, setMode] = useState<TenderMode>('Cash');
  const [cash, setCash] = useState('');
  const [gcash, setGcash] = useState('');
  const [reference, setReference] = useState('');

  // Reset whenever the dialog opens on a different bill, so yesterday's
  // half-typed amount never rides along into today's sale.
  useEffect(() => {
    if (!open) return;
    setMode('Cash');
    setCash(dueC > 0 ? toPesos(dueC).toFixed(2) : '');
    setGcash('');
    setReference('');
  }, [open, dueC]);

  const state = useMemo<TenderState>(() => {
    const cashC = mode === 'GCash' ? 0 : toCentavos(cash || 0);
    const gcashC = mode === 'Cash' ? 0 : toCentavos(gcash || 0);
    const tenderedC = cashC + gcashC;
    const appliedC = Math.min(tenderedC, dueC);
    const changeC = Math.max(0, tenderedC - dueC);
    const remainingC = Math.max(0, dueC - appliedC);

    const lines: PaymentLine[] = [];
    if (cashC > 0) lines.push({ modeOfPayment: 'Cash', amount: toPesos(cashC) });
    if (gcashC > 0) {
      lines.push({
        modeOfPayment: 'GCash',
        amount: toPesos(gcashC),
        ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
      });
    }

    let problem: string | null = null;
    if (tenderedC <= 0) problem = 'Enter an amount.';
    // Change comes out of the drawer. The server refuses this too; saying so
    // here means the cashier finds out before they have taken the money.
    else if (changeC > 0 && cashC === 0) {
      problem = 'That is more than the amount due, and GCash cannot give change.';
    }

    return { mode, cashC, gcashC, tenderedC, appliedC, changeC, remainingC, lines, problem };
  }, [mode, cash, gcash, reference, dueC]);

  const controls: TenderControls = {
    mode,
    cash,
    gcash,
    reference,
    setCash,
    setGcash,
    setReference,
    /**
     * Switching method carries the amount across rather than clearing it, so
     * "actually, they're paying by GCash" is one tap and not a re-entry — and
     * crucially leaves nothing behind in the field you are no longer using.
     */
    setMode: (next: TenderMode) => {
      const carried = toCentavos(cash || 0) + toCentavos(gcash || 0);
      const amount = carried > 0 ? toPesos(carried).toFixed(2) : '';
      if (next === 'Cash') {
        setCash(amount);
        setGcash('');
      } else if (next === 'GCash') {
        setGcash(amount);
        setCash('');
      } else {
        // Into Split: keep what is already in Cash and let them type the rest.
        if (!cash && !gcash) setCash(toPesos(dueC).toFixed(2));
      }
      setMode(next);
    },
  };

  return [state, controls];
}

export interface TenderControls {
  mode: TenderMode;
  cash: string;
  gcash: string;
  reference: string;
  setMode: (mode: TenderMode) => void;
  setCash: (value: string) => void;
  setGcash: (value: string) => void;
  setReference: (value: string) => void;
}

const MODES: Array<{ id: TenderMode; label: string; icon: typeof Banknote }> = [
  { id: 'Cash', label: 'Cash', icon: Banknote },
  { id: 'GCash', label: 'GCash', icon: Smartphone },
  { id: 'Split', label: 'Split', icon: SplitSquareHorizontal },
];

/** Notes a Philippine till actually holds. */
const NOTES = [50, 100, 200, 500, 1000];

export function PaymentEntry({
  dueC,
  state,
  controls,
  disabled,
  autoFocus,
}: {
  dueC: number;
  state: TenderState;
  controls: TenderControls;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const showCash = state.mode !== 'GCash';
  const showGcash = state.mode !== 'Cash';

  return (
    <div className="space-y-3">
      {/* Big enough to hit with a thumb without looking, which is how it is
          used: eyes on the customer, hand on the phone. */}
      <div
        role="radiogroup"
        aria-label="Mode of payment"
        className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1"
      >
        {MODES.map((entry) => {
          const Icon = entry.icon;
          const active = state.mode === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => controls.setMode(entry.id)}
              className={cn(
                'flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-all',
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

      {showCash ? (
        <div>
          <Input
            label={state.mode === 'Split' ? 'Cash portion' : 'Cash received'}
            type="text"
            inputMode="decimal"
            value={controls.cash}
            onChange={(event) => controls.setCash(event.target.value)}
            placeholder="0.00"
            disabled={disabled}
            autoFocus={autoFocus}
            className="h-12 text-lg font-bold tnum"
          />

          {/* Note keys, like the denomination buttons on a real till. */}
          <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            <button
              type="button"
              disabled={disabled || dueC <= 0}
              onClick={() =>
                controls.setCash(toPesos(Math.max(0, dueC - state.gcashC)).toFixed(2))
              }
              className="min-h-10 rounded-lg bg-navy-900 px-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Exact
            </button>
            {NOTES.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={disabled}
                onClick={() => controls.setCash(String(amount))}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-1 text-xs font-semibold text-navy-700 active:bg-slate-100 tnum"
              >
                {peso(amount)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showGcash ? (
        <div className="space-y-2">
          <Input
            label={state.mode === 'Split' ? 'GCash portion' : 'GCash amount'}
            type="text"
            inputMode="decimal"
            value={controls.gcash}
            onChange={(event) => controls.setGcash(event.target.value)}
            placeholder="0.00"
            disabled={disabled}
            autoFocus={autoFocus && state.mode === 'GCash'}
            className="h-12 text-lg font-bold tnum"
          />
          {state.mode === 'GCash' && dueC > 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => controls.setGcash(toPesos(dueC).toFixed(2))}
              className="min-h-10 w-full rounded-lg bg-navy-900 px-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Exact &middot; {peso(toPesos(dueC))}
            </button>
          ) : null}
          <Input
            label="GCash reference"
            value={controls.reference}
            onChange={(event) => controls.setReference(event.target.value)}
            placeholder="Optional"
            disabled={disabled}
          />
        </div>
      ) : null}

      <TenderSummary dueC={dueC} state={state} />
    </div>
  );
}

/** The three numbers a cashier reads out loud, and nothing else. */
export function TenderSummary({ dueC, state }: { dueC: number; state: TenderState }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-600">Due</span>
        <span className="font-semibold text-navy-900 tnum">{peso(toPesos(dueC))}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-600">Tendered</span>
        <span className="font-semibold text-navy-900 tnum">
          {peso(toPesos(state.tenderedC))}
        </span>
      </div>

      {state.changeC > 0 ? (
        <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-2">
          <span className="font-semibold text-navy-900">Change</span>
          <span className="text-lg font-bold text-emerald-700 tnum">
            {peso(toPesos(state.changeC))}
          </span>
        </div>
      ) : state.remainingC > 0 ? (
        <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-2">
          <span className="font-semibold text-navy-900">Still owing</span>
          <span className="text-lg font-bold text-red-600 tnum">
            {peso(toPesos(state.remainingC))}
          </span>
        </div>
      ) : state.tenderedC > 0 ? (
        <p className="mt-2 border-t border-slate-200 pt-2 text-sm font-semibold text-emerald-700">
          Exact payment &middot; fully settled
        </p>
      ) : null}

      {state.problem && state.tenderedC > 0 ? (
        <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
          {state.problem}
        </p>
      ) : null}
    </div>
  );
}
