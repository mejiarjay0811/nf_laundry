import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { computeTransactionMoney } from '@shared/calc';
import { toCentavos, toPesos } from '@shared/money';
import type { TransactionDto } from '@shared/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { api, errorMessage } from '@/lib/api';
import { peso } from '@/lib/format';
import { invalidateTransactionData } from '@/lib/queryClient';

/**
 * Correct an existing sale.
 *
 * Identity is immutable here — the O.R. number, transaction ID, customer and
 * service are shown read-only. Only an administrator may override the unit
 * price, and every change requires a reason that lands in the audit log.
 */
export function EditTransactionDialog({
  transaction,
  open,
  onClose,
  onSaved,
}: {
  transaction: TransactionDto | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (transaction: TransactionDto) => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { can } = useAuth();
  const isAdmin = can('orders.edit');

  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [additionalCharge, setAdditionalCharge] = useState('0');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && transaction) {
      setQuantity(String(transaction.quantity));
      setUnitPrice(transaction.unitPrice.toFixed(2));
      setDiscount(transaction.discount.toFixed(2));
      setAdditionalCharge(transaction.additionalCharge.toFixed(2));
      setNotes(transaction.notes);
      setReason('');
    }
  }, [open, transaction]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<{ transaction: TransactionDto }>(
        '/transactions/' + (transaction?.transactionId ?? ''),
        body,
      ),
    onSuccess: (result) => {
      invalidateTransactionData();
      toast.success('Transaction updated', result.transaction.orNumber);
      onSaved?.(result.transaction);
      onClose();
    },
    onError: (error) => toast.error('Unable to update transaction', errorMessage(error)),
  });

  if (!transaction) return null;

  const preview = computeTransactionMoney({
    unitPrice: toCentavos(unitPrice || 0),
    quantity: Number.parseInt(quantity, 10) || 0,
    discount: toCentavos(discount || 0),
    additionalCharge: toCentavos(additionalCharge || 0),
    paidAmount: toCentavos(transaction.paidAmount),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Edit transaction"
      description={transaction.orNumber + ' \u00B7 ' + transaction.customerName}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              // A correction rewrites a recorded sale, so the new total is
              // shown back before it is committed.
              const ok = await confirm({
                title: 'Save this correction?',
                confirmLabel: 'Save correction',
                message: (
                  <>
                    The total changes from <strong>{peso(transaction.totalPayment)}</strong> to{' '}
                    <strong>{peso(toPesos(preview.total))}</strong>.
                    {preview.balance > 0 ? (
                      <span className="mt-2 block font-medium text-amber-700">
                        This will leave {peso(toPesos(preview.balance))} outstanding.
                      </span>
                    ) : null}
                    <span className="mt-2 block text-slate-500">
                      The reason is recorded in the audit trail.
                    </span>
                  </>
                ),
              });
              if (ok) {
                mutation.mutate({
                  quantity: Number.parseInt(quantity, 10) || 1,
                  ...(isAdmin ? { unitPrice: toPesos(toCentavos(unitPrice || 0)) } : {}),
                  discount: toPesos(toCentavos(discount || 0)),
                  additionalCharge: toPesos(toCentavos(additionalCharge || 0)),
                  notes: notes.trim(),
                  reason: reason.trim(),
                });
              }
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p>
            <span className="font-medium text-navy-800">{transaction.serviceType}</span> for{' '}
            {transaction.customerName}. The O.R. number and transaction ID never change.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Quantity"
            type="number"
            min={1}
            max={999}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={mutation.isPending}
          />
          <Input
            label="Unit price"
            inputMode="decimal"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            disabled={!isAdmin || mutation.isPending}
            hint={isAdmin ? 'Historical price' : 'Administrator only'}
            leading={<span className="text-sm">{'\u20B1'}</span>}
          />
          <Input
            label="Discount"
            inputMode="decimal"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            disabled={mutation.isPending}
            leading={<span className="text-sm">{'\u20B1'}</span>}
          />
          <Input
            label="Additional charge"
            inputMode="decimal"
            value={additionalCharge}
            onChange={(event) => setAdditionalCharge(event.target.value)}
            disabled={mutation.isPending}
            leading={<span className="text-sm">{'\u20B1'}</span>}
          />
        </div>

        <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">New total</span>
            <span className="font-semibold tnum">{peso(toPesos(preview.total))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Already paid</span>
            <span className="tnum">{peso(transaction.paidAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1">
            <span className="font-medium text-navy-900">
              {preview.change > 0 ? 'Refund due' : 'Balance'}
            </span>
            <span
              className={
                preview.change > 0
                  ? 'font-semibold text-emerald-700 tnum'
                  : preview.balance > 0
                    ? 'font-semibold text-red-600 tnum'
                    : 'font-semibold tnum'
              }
            >
              {peso(toPesos(preview.change > 0 ? preview.change : preview.balance))}
            </span>
          </div>
        </div>

        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={mutation.isPending}
        />

        <Textarea
          label="Reason for this correction"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Recorded in the audit log. Required."
          required
          disabled={mutation.isPending}
        />
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}
