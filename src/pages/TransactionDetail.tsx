import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, CreditCard, Pencil, Printer } from 'lucide-react';
import { ORDER_FLOW, type OrderStatus } from '@shared/constants';
import { formatDateTime, formatLongDate } from '@shared/datetime';
import type { PaymentDto, TransactionDto } from '@shared/types';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { PaymentDialog } from '@/components/PaymentDialog';
import { ReceiptModal } from '@/components/ReceiptModal';
import { OrderBadge, PaymentBadge, PickupBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useConfirm } from '@/components/ui/useConfirm';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useCancelMutation, useStatusMutation } from '@/hooks/useTransactionActions';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';
import { EditTransactionDialog } from '@/components/EditTransactionDialog';

function DetailRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  tone?: 'negative' | 'positive';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={cn('text-sm', strong ? 'font-semibold text-navy-900' : 'text-slate-600')}>
        {label}
      </dt>
      <dd
        className={cn(
          'text-right tnum',
          strong ? 'text-base font-bold' : 'text-sm font-medium',
          tone === 'negative' && 'text-red-600',
          tone === 'positive' && 'text-emerald-700',
          !tone && 'text-navy-900',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusStepper({
  current,
  onSelect,
  disabled,
}: {
  current: OrderStatus;
  onSelect: (status: OrderStatus) => void;
  disabled: boolean;
}) {
  const currentIndex = ORDER_FLOW.indexOf(current);

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order status">
      {ORDER_FLOW.map((status, index) => {
        const active = status === current;
        const done = currentIndex >= 0 && index < currentIndex;
        return (
          <button
            key={status}
            type="button"
            onClick={() => onSelect(status)}
            disabled={disabled || active}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'h-9 rounded-lg border px-3 text-xs font-medium transition-colors disabled:cursor-default',
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-slate-300 bg-white text-navy-700 hover:bg-slate-50',
            )}
          >
            {status}
          </button>
        );
      })}
    </div>
  );
}

export default function TransactionDetail() {
  const { transactionId = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const isAdmin = can('orders.cancel');
  const { confirm, confirmDialog } = useConfirm();

  const [payOpen, setPayOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [balancePrompt, setBalancePrompt] = useState<{ status: OrderStatus; balance: number } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['transactions', 'detail', transactionId],
    queryFn: ({ signal }) =>
      api.get<{ transaction: TransactionDto; payments: PaymentDto[] }>(
        '/transactions/' + transactionId,
        undefined,
        signal,
      ),
    enabled: Boolean(transactionId),
  });

  const transaction = query.data?.transaction ?? null;
  useDocumentTitle(transaction ? transaction.orNumber : 'Transaction');

  const statusMutation = useStatusMutation({
    onBalanceBlocked: (_id, balance) => setBalancePrompt({ status: 'Picked Up', balance }),
  });
  const cancelMutation = useCancelMutation(() => {
    setCancelOpen(false);
    setCancelReason('');
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (query.isError || !transaction) {
    return (
      <div className="card">
        <ErrorState
          title="Transaction not found"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const cancelled = transaction.status === 'Cancelled';
  const payments = query.data?.payments ?? [];

  return (
    <>
      <PageHeader
        title={transaction.orNumber}
        subtitle={
          transaction.transactionId +
          ' \u00B7 ' +
          formatDateTime(transaction.timeStamp || transaction.transactionDate)
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            >
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReceiptOpen(true)}
              icon={<Printer className="h-4 w-4" aria-hidden="true" />}
            >
              Receipt
            </Button>
            {!cancelled && transaction.balance > 0 ? (
              <Button
                size="sm"
                onClick={() => setPayOpen(true)}
                icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
              >
                Record payment
              </Button>
            ) : null}
            {!cancelled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
                icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
              >
                Edit
              </Button>
            ) : null}
            {isAdmin && !cancelled ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setCancelOpen(true)}
                icon={<Ban className="h-4 w-4" aria-hidden="true" />}
              >
                Cancel
              </Button>
            ) : null}
          </>
        }
      />

      {cancelled ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          This transaction was cancelled. The record is kept for audit purposes and is excluded
          from all sales figures.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Order"
              action={
                <div className="flex flex-wrap gap-1.5">
                  <OrderBadge status={transaction.orderStatus} />
                  <PickupBadge status={transaction.pickupStatus} />
                </div>
              }
            />
            <CardBody className="space-y-4">
              {!cancelled ? (
                <div>
                  <p className="label">Move to</p>
                  <StatusStepper
                    current={transaction.orderStatus}
                    disabled={statusMutation.isPending}
                    onSelect={async (status) => {
                      const ok = await confirm({
                        title: 'Move this order to ' + status + '?',
                        confirmLabel: 'Yes, move it',
                        message: (
                          <>
                            <strong>{transaction.orNumber}</strong> {'·'} {transaction.customerName}
                            <br />
                            {status === 'Picked Up'
                              ? 'This records that the customer has taken their laundry.'
                              : 'The order will show as ' + status + ' everywhere in the app.'}
                          </>
                        ),
                      });
                      if (ok) {
                        statusMutation.mutate({
                          transactionId: transaction.transactionId,
                          orderStatus: status,
                        });
                      }
                    }}
                  />
                </div>
              ) : null}

              <dl className="divide-y divide-slate-100">
                <DetailRow label="Service" value={transaction.serviceType} />
                <DetailRow label="Quantity" value={String(transaction.quantity)} />
                <DetailRow label="Unit price" value={peso(transaction.unitPrice)} />
                <DetailRow
                  label="Transaction date"
                  value={formatLongDate(transaction.transactionDate)}
                />
                {transaction.expectedPickup ? (
                  <DetailRow
                    label="Expected pickup"
                    value={formatLongDate(transaction.expectedPickup)}
                  />
                ) : null}
                {transaction.datePickedUp ? (
                  <DetailRow
                    label="Collected"
                    value={formatDateTime(transaction.datePickedUp)}
                  />
                ) : null}
                {transaction.pickedUpBy ? (
                  <DetailRow label="Released to" value={transaction.pickedUpBy} />
                ) : null}
                <DetailRow label="Created by" value={transaction.createdBy} />
                {transaction.updatedBy && transaction.updatedBy !== transaction.createdBy ? (
                  <DetailRow label="Last updated by" value={transaction.updatedBy} />
                ) : null}
                {transaction.notes ? (
                  <DetailRow label="Notes" value={transaction.notes} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Payment history"
              subtitle={payments.length + ' recorded ' + (payments.length === 1 ? 'entry' : 'entries')}
            />
            {payments.length === 0 ? (
              <CardBody>
                <p className="py-4 text-center text-sm text-slate-500">
                  No payments recorded yet.
                </p>
              </CardBody>
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Method</Th>
                    <Th>Reference</Th>
                    <Th>Received by</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <Tr key={payment.paymentId}>
                      <Td className="whitespace-nowrap text-slate-600 tnum">
                        {formatDateTime(payment.paymentDate)}
                      </Td>
                      <Td>{payment.modeOfPayment}</Td>
                      <Td className="text-slate-500">{payment.referenceNumber || '\u2014'}</Td>
                      <Td className="text-slate-600">{payment.receivedBy}</Td>
                      <Td
                        align="right"
                        className={
                          payment.status === 'Cancelled'
                            ? 'text-slate-400 line-through'
                            : 'font-medium'
                        }
                      >
                        {peso(payment.amount)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <Link
                to={'/customers/' + transaction.customerId}
                className="block font-medium text-navy-900 hover:text-brand-700 hover:underline"
              >
                {transaction.customerName}
              </Link>
              <p className="text-sm text-slate-600 tnum">{transaction.contactNumber}</p>
              <p className="mt-0.5 text-xs text-slate-400">{transaction.customerId}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Amount"
              action={<PaymentBadge status={transaction.paymentStatus} />}
            />
            <CardBody>
              <dl>
                <DetailRow label="Subtotal" value={peso(transaction.subtotal)} />
                {transaction.discount > 0 ? (
                  <DetailRow
                    label="Discount"
                    value={'-' + peso(transaction.discount)}
                    tone="positive"
                  />
                ) : null}
                {transaction.additionalCharge > 0 ? (
                  <DetailRow
                    label="Additional charge"
                    value={peso(transaction.additionalCharge)}
                  />
                ) : null}
                <div className="my-1 border-t border-slate-200" />
                <DetailRow label="Total" value={peso(transaction.totalPayment)} strong />
                <DetailRow label="Paid" value={peso(transaction.paidAmount)} />
                {transaction.change > 0 ? (
                  <DetailRow
                    label="Change given"
                    value={peso(transaction.change)}
                    tone="positive"
                  />
                ) : null}
                <DetailRow
                  label="Balance"
                  value={peso(transaction.balance)}
                  strong
                  tone={transaction.balance > 0 ? 'negative' : 'positive'}
                />
                <DetailRow
                  label="Method"
                  value={transaction.modeOfPayment || 'Not yet paid'}
                />
                {transaction.datePaid ? (
                  <DetailRow label="Settled on" value={formatDateTime(transaction.datePaid)} />
                ) : null}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      <PaymentDialog
        transaction={transaction}
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onSettled={() => void query.refetch()}
      />

      <ReceiptModal
        transaction={transaction}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Reprint receipt"
      />

      <EditTransactionDialog
        transaction={transaction}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => void query.refetch()}
      />

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        busy={cancelMutation.isPending}
        title="Cancel this transaction?"
        description={transaction.orNumber + ' \u00B7 ' + transaction.customerName}
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={cancelMutation.isPending}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={cancelMutation.isPending}
              disabled={cancelReason.trim().length < 3}
              onClick={() =>
                cancelMutation.mutate({
                  transactionId: transaction.transactionId,
                  reason: cancelReason.trim(),
                })
              }
            >
              Cancel transaction
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-700">
          The row stays in the spreadsheet with a status of Cancelled — nothing is deleted. It is
          removed from all sales figures.
        </p>
        <Textarea
          label="Reason"
          rows={3}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          hint="Recorded in the audit log. Required."
          required
          disabled={cancelMutation.isPending}
        />
      </Modal>

      <Modal
        open={balancePrompt !== null}
        onClose={() => setBalancePrompt(null)}
        busy={statusMutation.isPending}
        title="Release with an unpaid balance?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setBalancePrompt(null)}>
              Go back
            </Button>
            <Button
              variant="danger"
              loading={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate(
                  {
                    transactionId: transaction.transactionId,
                    orderStatus: 'Picked Up',
                    acknowledgeBalance: true,
                  },
                  { onSettled: () => setBalancePrompt(null) },
                )
              }
            >
              Release anyway
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          {transaction.customerName} still owes{' '}
          <strong className="tnum">{peso(balancePrompt?.balance ?? transaction.balance)}</strong>.
          Releasing the laundry now keeps the balance recorded as outstanding.
        </p>
      </Modal>

      {confirmDialog}
    </>
  );
}
