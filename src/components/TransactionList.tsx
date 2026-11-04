import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { formatShortDate } from '@shared/datetime';
import type { TransactionDto } from '@shared/types';
import { OrderBadge, PaymentBadge } from '@/components/ui/Badge';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { peso } from '@/lib/format';

/**
 * Shared renderer for a list of transactions.
 *
 * Below `sm` the table becomes a stack of cards rather than a shrunken grid —
 * a horizontally squeezed data table is unusable on a phone.
 *
 * When `onCollect` is supplied, any row still owing money gets a button that
 * settles it in place. Someone arriving to pay an outstanding order is a
 * counter routine, and it should not require opening the order first.
 */
export function TransactionList({
  items,
  showCustomer = true,
  onCollect,
}: {
  items: TransactionDto[];
  showCustomer?: boolean;
  onCollect?: (transaction: TransactionDto) => void;
}) {
  const owes = (transaction: TransactionDto) =>
    transaction.balance > 0 &&
    transaction.status !== 'Cancelled' &&
    transaction.paymentStatus !== 'Refunded';

  /*
   * What the bill actually took, not what was put on the counter.
   *
   * `paidAmount` records the tender, so a ₱600 order settled with a ₱1,000 note
   * stores 1000 — and a column headed "Paid" showing ₱1,000 beside a ₱600 total
   * reads as though the shop kept the difference. The ₱400 went back as change,
   * so this column shows what was applied and the change is noted beside it.
   */
  const applied = (transaction: TransactionDto) =>
    Math.min(transaction.paidAmount, transaction.totalPayment);

  return (
    <>
      <div className="hidden sm:block">
        <TableWrap>
          <thead>
            <tr>
              {/* First column, so an unpaid order can be settled without the
                  eye having to travel to the end of the row. */}
              {onCollect ? <Th>{''}</Th> : null}
              <Th>O.R. No.</Th>
              <Th>Date</Th>
              {showCustomer ? <Th>Customer</Th> : null}
              <Th>Service</Th>
              <Th align="right">Total</Th>
              <Th align="right">Paid</Th>
              <Th align="right">Balance</Th>
              <Th>Payment</Th>
              <Th>Order</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((transaction) => (
              <Tr key={transaction.transactionId}>
                {onCollect ? (
                  <Td>
                    {owes(transaction) ? (
                      <button
                        type="button"
                        onClick={() => onCollect(transaction)}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-600 bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                        Pay
                      </button>
                    ) : null}
                  </Td>
                ) : null}
                <Td>
                  <Link
                    to={'/transactions/' + transaction.transactionId}
                    className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {transaction.orNumber}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-slate-600 tnum">
                  {formatShortDate(transaction.transactionDate)}
                </Td>
                {showCustomer ? (
                  <Td>
                    <Link
                      to={'/customers/' + transaction.customerId}
                      className="font-medium text-navy-800 hover:text-brand-700 hover:underline"
                    >
                      {transaction.customerName}
                    </Link>
                  </Td>
                ) : null}
                <Td className="whitespace-nowrap text-slate-600">
                  {transaction.serviceType}
                  <span className="ml-1 text-slate-400 tnum">{'×'}{transaction.quantity}</span>
                </Td>
                <Td align="right" className="font-medium">
                  {peso(transaction.totalPayment)}
                </Td>
                <Td align="right" className="text-slate-600">
                  {peso(applied(transaction))}
                  {transaction.change > 0 ? (
                    <span className="ml-1 whitespace-nowrap text-xs text-slate-400">
                      ({peso(transaction.change)} chg)
                    </span>
                  ) : null}
                </Td>
                <Td
                  align="right"
                  className={transaction.balance > 0 ? 'font-medium text-red-600' : 'text-slate-400'}
                >
                  {peso(transaction.balance)}
                </Td>
                <Td>
                  <PaymentBadge status={transaction.paymentStatus} />
                </Td>
                <Td>
                  <OrderBadge status={transaction.orderStatus} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <ul className="divide-y divide-slate-100 sm:hidden">
        {items.map((transaction) => (
          <li key={transaction.transactionId}>
            <Link
              to={'/transactions/' + transaction.transactionId}
              className="block px-4 py-3 active:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-brand-700">
                  {transaction.orNumber}
                </span>
                <PaymentBadge status={transaction.paymentStatus} />
              </div>
              {showCustomer ? (
                <p className="mt-1 truncate text-sm font-medium text-navy-900">
                  {transaction.customerName}
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                {transaction.serviceType} {'×'} {transaction.quantity} {'·'}{' '}
                {formatShortDate(transaction.transactionDate)}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-navy-900 tnum">
                  {peso(transaction.totalPayment)}
                </span>
                {transaction.balance > 0 ? (
                  <span className="text-xs font-medium text-red-600 tnum">
                    {peso(transaction.balance)} due
                  </span>
                ) : null}
                <OrderBadge status={transaction.orderStatus} />
              </div>
            </Link>

            {/* Outside the link, so tapping it settles the order instead of
                navigating away from the list. */}
            {onCollect && owes(transaction) ? (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => onCollect(transaction)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-600 bg-brand-600 px-3 py-2 text-sm font-semibold text-white active:bg-brand-700"
                >
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  Pay {peso(transaction.balance)}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
