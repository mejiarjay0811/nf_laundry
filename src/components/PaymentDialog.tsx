import { useRef, useState } from 'react';
import { Banknote, Check, Smartphone } from 'lucide-react';
import { toCentavos, toPesos } from '@shared/money';
import type { TransactionDto } from '@shared/types';
import { PaymentEntry, useTender } from '@/components/PaymentEntry';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { usePaymentMutation } from '@/hooks/useTransactionActions';
import { newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';

/**
 * Settling an outstanding balance.
 *
 * The method is chosen first, then the amount — see PaymentEntry for why that
 * ordering matters. Confirming before saving matches the till: by the time
 * this dialog is open the money has already changed hands, so the cashier is
 * checking what they are about to write down, not deciding it.
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
  const [reviewing, setReviewing] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  const balanceC = toCentavos(transaction?.balance ?? 0);
  const [tender, controls] = useTender(balanceC, open && Boolean(transaction));

  const mutation = usePaymentMutation((updated) => {
    onSettled?.(updated);
    onClose();
  });

  // A fresh key per opening, so a retry after a dropped connection replays the
  // same payment instead of recording a second one.
  if (open && !reviewing && !mutation.isPending && idempotencyKey.current === '') {
    idempotencyKey.current = newIdempotencyKey();
  }

  if (!transaction) return null;

  const save = () => {
    mutation.mutate({
      transactionId: transaction.transactionId,
      payments: tender.lines,
      idempotencyKey: idempotencyKey.current,
    });
    idempotencyKey.current = '';
  };

  const summary = (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
      <div className="flex justify-between">
        <span className="text-slate-600">Applied to this bill</span>
        <span className="font-medium tnum">{peso(toPesos(tender.appliedC))}</span>
      </div>
      {tender.changeC > 0 ? (
        <div className="flex justify-between">
          <span className="text-slate-600">Change to hand back</span>
          <span className="font-semibold text-emerald-700 tnum">
            {peso(toPesos(tender.changeC))}
          </span>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-slate-200 pt-1">
        <span className="font-medium text-navy-900">Remaining balance</span>
        <span
          className={cn(
            'font-semibold tnum',
            tender.remainingC > 0 ? 'text-red-600' : 'text-emerald-700',
          )}
        >
          {peso(toPesos(tender.remainingC))}
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
              Record {peso(toPesos(tender.appliedC))}
            </Button>
          </>
        }
      >
        <dl className="space-y-2.5 text-sm">
          {tender.cashC > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="flex items-center gap-1.5 text-slate-600">
                <Banknote className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                Cash
              </dt>
              <dd className="font-medium tnum">{peso(toPesos(tender.cashC))}</dd>
            </div>
          ) : null}
          {tender.gcashC > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="flex items-center gap-1.5 text-slate-600">
                <Smartphone className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                GCash
                {controls.reference.trim() ? (
                  <span className="text-xs text-slate-400">ref {controls.reference.trim()}</span>
                ) : null}
              </dt>
              <dd className="font-medium tnum">{peso(toPesos(tender.gcashC))}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2.5">
            <dt className="font-semibold text-navy-900">Total received</dt>
            <dd className="text-lg font-bold text-navy-900 tnum">
              {peso(toPesos(tender.tenderedC))}
            </dd>
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
          <Button disabled={Boolean(tender.problem)} onClick={() => setReviewing(true)}>
            Review payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-navy-900 p-3 text-white">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
              Balance due
            </span>
            <span className="text-2xl font-bold tnum">{peso(transaction.balance)}</span>
          </div>
        </div>

        <PaymentEntry dueC={balanceC} state={tender} controls={controls} disabled={mutation.isPending} autoFocus />
      </div>
    </Modal>
  );
}
