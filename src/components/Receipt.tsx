import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PaymentDto, TransactionDto } from '@shared/types';
import { formatDateTime, formatLongDate } from '@shared/datetime';
import { peso } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface BusinessProfile {
  name: string;
  address: string;
  contact: string;
  email: string;
  logo: string;
  receiptHeader: string;
  receiptFooter: string;
  showQr: boolean;
  paperWidth: string;
}

interface ReceiptProps {
  transaction: TransactionDto;
  business: BusinessProfile;
  /**
   * Ledger rows for this sale. When a bill was settled with more than one
   * method the receipt lists each, rather than the bare "Cash + GCash" label.
   */
  payments?: PaymentDto[];
  /** '58mm' | '80mm' | 'a4' — controls the printable width. */
  width?: string;
  className?: string;
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-0.5 text-[11px] leading-snug',
        bold && 'text-[13px] font-bold',
        muted && 'text-slate-500',
      )}
    >
      <span className={cn(!bold && 'text-slate-600')}>{label}</span>
      <span className={cn('tnum text-right', bold ? 'text-navy-900' : 'font-medium text-navy-800')}>
        {value}
      </span>
    </div>
  );
}

const Divider = () => <div className="my-1.5 border-t border-dashed border-slate-300" />;

/**
 * The printable receipt.
 *
 * Rendered at a fixed millimetre width so it feeds correctly through a 58mm or
 * 80mm thermal printer; the print stylesheet hides everything else on the page.
 */
export function Receipt({ transaction, business, payments, width, className }: ReceiptProps) {
  const [qr, setQr] = useState<string>('');
  const paper = width ?? business.paperWidth ?? '80mm';

  useEffect(() => {
    if (!business.showQr) {
      setQr('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(transaction.transactionId, {
      margin: 0,
      width: 160,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => setQr(''));
    return () => {
      cancelled = true;
    };
  }, [transaction.transactionId, business.showQr]);

  return (
    <div
      className={cn(
        'print-area mx-auto bg-white px-3 py-4 font-mono text-navy-900',
        paper === '58mm' && 'receipt-58mm',
        paper === '80mm' && 'receipt-80mm',
        paper === 'a4' && 'w-full max-w-[420px]',
        className,
      )}
    >
      <div className="text-center">
        <h2 className="text-sm font-bold uppercase tracking-wide">
          {business.receiptHeader || business.name}
        </h2>
        {business.address ? (
          <p className="mt-0.5 text-[10px] leading-tight text-slate-600">{business.address}</p>
        ) : null}
        {business.contact ? (
          <p className="text-[10px] text-slate-600 tnum">{business.contact}</p>
        ) : null}
        {business.email ? <p className="text-[10px] text-slate-600">{business.email}</p> : null}
      </div>

      <Divider />

      <Row label="O.R. No." value={transaction.orNumber} bold />
      <Row label="Transaction" value={transaction.transactionId} />
      <Row label="Date" value={formatLongDate(transaction.timeStamp || transaction.transactionDate)} />
      <Row label="Time" value={formatDateTime(transaction.timeStamp)} />
      <Row label="Cashier" value={transaction.createdBy} />

      <Divider />

      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customer</p>
      <p className="text-[11px] font-medium">{transaction.customerName}</p>
      {transaction.contactNumber ? (
        <p className="text-[10px] text-slate-600 tnum">{transaction.contactNumber}</p>
      ) : null}

      <Divider />

      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="font-medium">{transaction.serviceType}</span>
        <span className="tnum">{peso(transaction.subtotal)}</span>
      </div>
      <p className="text-[10px] text-slate-600 tnum">
        {transaction.quantity} {'\u00D7'} {peso(transaction.unitPrice)}
      </p>

      <Divider />

      <Row label="Subtotal" value={peso(transaction.subtotal)} />
      {transaction.discount > 0 ? (
        <Row label="Discount" value={'-' + peso(transaction.discount)} />
      ) : null}
      {transaction.additionalCharge > 0 ? (
        <Row label="Additional charge" value={peso(transaction.additionalCharge)} />
      ) : null}

      <Divider />

      <Row label="TOTAL" value={peso(transaction.totalPayment)} bold />
      <Row label="Paid" value={peso(transaction.paidAmount)} />
      {transaction.change > 0 ? <Row label="Change" value={peso(transaction.change)} /> : null}
      {transaction.balance > 0 ? (
        <Row label="BALANCE DUE" value={peso(transaction.balance)} bold />
      ) : null}

      <Divider />

      {payments && payments.length > 1 ? (
        <>
          {payments.map((payment) => (
            <Row
              key={payment.paymentId}
              label={payment.modeOfPayment}
              value={peso(payment.amount)}
            />
          ))}
        </>
      ) : (
        <Row label="Payment" value={transaction.modeOfPayment || 'Not yet paid'} />
      )}
      <Row label="Status" value={transaction.paymentStatus} />
      <Row label="Order" value={transaction.orderStatus} />
      <Row label="Pickup" value={transaction.pickupStatus} />
      {transaction.expectedPickup ? (
        <Row label="Ready by" value={formatLongDate(transaction.expectedPickup)} muted />
      ) : null}
      {transaction.datePickedUp ? (
        <Row label="Collected" value={formatDateTime(transaction.datePickedUp)} muted />
      ) : null}

      {transaction.notes ? (
        <>
          <Divider />
          <p className="text-[10px] leading-snug text-slate-600">{transaction.notes}</p>
        </>
      ) : null}

      <Divider />

      {qr ? (
        <div className="flex flex-col items-center gap-1 py-1">
          <img src={qr} alt={'QR code for ' + transaction.transactionId} className="h-20 w-20" />
          <p className="text-[9px] text-slate-500">{transaction.transactionId}</p>
        </div>
      ) : null}

      <p className="mt-1 text-center text-[10px] leading-snug text-slate-600">
        {business.receiptFooter || 'Thank you for your business!'}
      </p>
      <p className="mt-1 text-center text-[9px] text-slate-400">
        Please keep this receipt for claiming your laundry.
      </p>
    </div>
  );
}
