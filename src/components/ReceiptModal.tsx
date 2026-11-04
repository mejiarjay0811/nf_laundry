import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import type { PaymentDto, TransactionDto } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Receipt, type BusinessProfile } from '@/components/Receipt';
import { Spinner } from '@/components/ui/States';
import { api } from '@/lib/api';

export function useBusinessProfile() {
  return useQuery({
    queryKey: ['settings', 'business'],
    queryFn: ({ signal }) =>
      api.get<{ business: BusinessProfile }>('/settings', undefined, signal),
    staleTime: 10 * 60_000,
    select: (data) => data.business,
  });
}

/**
 * Receipt preview with print and reprint.
 *
 * Printing uses the browser's own dialog together with the print stylesheet,
 * which hides the app chrome — that is also how a receipt is saved as PDF.
 */
export function ReceiptModal({
  transaction,
  open,
  onClose,
  title = 'Receipt',
}: {
  transaction: TransactionDto | null;
  open: boolean;
  onClose: () => void;
  title?: string;
}) {
  const { data: business, isLoading } = useBusinessProfile();

  // Ledger rows, so a split payment prints as its parts rather than as the
  // bare "Cash + GCash" label.
  const { data: payments } = useQuery({
    queryKey: ['transactions', 'detail', transaction?.transactionId, 'payments'],
    queryFn: ({ signal }) =>
      api.get<{ payments: PaymentDto[] }>(
        '/transactions/' + (transaction?.transactionId ?? ''),
        undefined,
        signal,
      ),
    enabled: open && Boolean(transaction?.transactionId),
    staleTime: 60_000,
    select: (data) => data.payments,
  });

  if (!transaction) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={transaction.orNumber + ' \u00B7 ' + transaction.customerName}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => window.print()}
            icon={<Printer className="h-4 w-4" aria-hidden="true" />}
            disabled={!business}
          >
            Print receipt
          </Button>
        </>
      }
    >
      {isLoading || !business ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex justify-center bg-slate-100 py-4">
          <div className="shadow-card">
            <Receipt transaction={transaction} business={business} payments={payments} />
          </div>
        </div>
      )}
    </Modal>
  );
}
