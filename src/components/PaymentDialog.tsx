import { useEffect, useRef, useState } from 'react';
import { Banknote, Check, Smartphone } from 'lucide-react';
import type { PaymentMode } from '@shared/constants';
import { toCentavos, toPesos } from '@shared/money';
import type { TransactionDto } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { usePaymentMutation } from '@/hooks/useTransactionActions';
import { newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';

/**
 * Settling an outstanding balance.
 *
 * Cash and GCash are separate amounts rather than a choice between them,
 * because a customer settling ₱175 with ₱100 cash and ₱75 GCash is routine —
 * the same way the till takes a sale. Confirming before saving matches the
 * till too: money has already changed hands by this point.
 */
export function PaymentDialog({
  transaction,
  open,
  onClose,
  onSettled,
}: {
  transaction: TransactionDto | null;
  open: boolean;
  onClose: () => void;
  onSettled?: (transaction: TransactionDto) => void;
}) {
  const [cash, setCash] = useState('');
  const [gcash, setGcash] = useState('');
  const [reference, setReference] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  const mutation = usePaymentMutation((updated) => {
    onSettled?.(updated);
    onClose();
  });

  useEffect(() => {
    if (open && transaction) {
      setCash(transaction.balance > 0 ? transaction.balance.toFixed(2) : '');
      setGcash('');
      setReference('');
      setReviewing(false);
      idempotencyKey.current = newIdempotencyKey();
    }
  }, [open, transaction]);

  if (!transaction) return null;

  const cashC = toCentavos(cash || 0);
  const gcashC = toCentavos(gcash || 0);
  const tenderedC = cashC + gcashC;
  const balanceC = toCentavos(transaction.balance);
  const appliedC = Math.min(tenderedC, balanceC);
  const changeC = Math.max(0, tenderedC - balanceC);
  const remainingC = Math.max(0, balanceC - appliedC);

  // Change comes out of the drawer, so an overpayment with no cash in it cannot
  // be given back. The server refuses this too.
  const changeWithoutCash = changeC > 0 && cashC === 0;
  const canSubmit = tenderedC > 0 && !changeWithoutCash;

  const lines: Array<{ modeOfPayment: PaymentMode; amount: number; referenceNumber?: string }> = [];
  if (cashC > 0) lines.push({ modeOfPayment: 'Cash', amount: toPesos(cashC) });
  if (gcashC > 0) {
    lines.push({
      modeOfPayment: 'GCash',
      amount: toPesos(gcashC),
      ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
    });
  }

  const save = () =>
    mutation.mutate({
      transactionId: transaction.transactionId,
      payments: lines,
      idempotencyKey: idempotencyKey.current,
    });

  const summary = (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
      <div className="flex justify-between">
        <span className="text-slate-600">Applied to this bill</span>
        <span className="font-medium tnum">{peso(toPesos(appliedC))}</span>
      </div>
      {changeC > 0 ? (
        <div className="flex justify-between">
          <span className="text-slate-600">Change to hand back</span>
          <span className="font-semibold text-emerald-700 tnum">{peso(toPesos(changeC))}</span>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-slate-200 pt-1">
        <span className="font-medium text-navy-900">Remaining balance</span>
        <span
          className={cn('font-semibold tnum', remainingC > 0 ? 'text-red-600' : 'text-emerald-700')}
        >
          {peso(toPesos(remainingC))}
        </span>
      </div>
    </div>
  );

  /* ------------------------------------------------------------- review */

  if (reviewing) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        busy={mutation.isPending}
        title="Confirm this payment"
        description={transaction.orNumber + ' · ' + transaction.customerName}
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setReviewing(false)}
              disabled={mutation.isPending}
            >
              Go back
            </Button>
            <Button
              loading={mutation.isPending}
              onClick={save}
              icon={<Check className="h-4 w-4" aria-hidden="true" />}
            >
              Record {peso(toPesos(appliedC))}
            </Button>
          </>
        }
      >
        <dl className="space-y-2.5 text-sm">
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
                {reference.trim() ? (
                  <span className="text-xs text-slate-400">ref {reference.trim()}</span>
                ) : null}
              </dt>
              <dd className="font-medium tnum">{peso(toPesos(gcashC))}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2.5">
            <dt className="font-semibold text-navy-900">Total received</dt>
            <dd className="text-lg font-bold text-navy-900 tnum">{peso(toPesos(tenderedC))}</dd>
          </div>
        </dl>
        <div className="mt-4">{summary}</div>
      </Modal>
    );
  }

  /* --------------------------------------------------------------- entry */

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Record payment"
      description={transaction.orNumber + ' · ' + transaction.customerName}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => setReviewing(true)}>
            Review payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-600">Total</span>
            <span className="text-sm font-medium tnum">{peso(transaction.totalPayment)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-600">Already paid</span>
            <span className="text-sm font-medium tnum">{peso(transaction.paidAmount)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-1">
            <span className="text-sm font-semibold text-navy-900">Balance</span>
            <span className="text-base font-bold text-red-600 tnum">
              {peso(transaction.balance)}
            </span>
          </div>
        </div>

        <Input
          label="Cash"
          inputMode="decimal"
          value={cash}
          onChange={(event) => setCash(event.target.value)}
          leading={<Banknote className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          placeholder="0.00"
          disabled={mutation.isPending}
          className="text-lg font-semibold tnum"
          autoFocus
        />

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCash(toPesos(Math.max(0, balanceC - gcashC)).toFixed(2))}
            disabled={mutation.isPending || balanceC <= 0}
            className="rounded-lg border border-navy-900 bg-navy-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Exact
          </button>
          {[100, 200, 500, 1000].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setCash(String(amount))}
              disabled={mutation.isPending}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 tnum"
            >
              {peso(amount)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCash('');
              setGcash('');
            }}
            disabled={mutation.isPending}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>

        {/* Half cash, half GCash is a single settlement, not two payments. */}
        <Input
          label="GCash"
          inputMode="decimal"
          value={gcash}
          onChange={(event) => setGcash(event.target.value)}
          leading={<Smartphone className="h-4 w-4 text-brand-600" aria-hidden="true" />}
          placeholder="0.00"
          hint="Leave blank unless part of it is paid by GCash"
          disabled={mutation.isPending}
          className="text-lg font-semibold tnum"
        />

        {gcashC > 0 ? (
          <Input
            label="GCash reference number"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            hint="Optional"
            disabled={mutation.isPending}
          />
        ) : null}

        {changeWithoutCash ? (
          <p className="rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-700" role="alert">
            That is more than the balance, and change cannot be given for a GCash payment.
            Enter the exact amount.
          </p>
        ) : null}

        {summary}
      </div>
    </Modal>
  );
}
