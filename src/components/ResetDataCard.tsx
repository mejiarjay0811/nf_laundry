import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';

interface ResetPreview {
  transactions: number;
  payments: number;
  customers: number;
}

interface ResetSummary {
  transactionsRemoved: number;
  paymentsRemoved: number;
  customersReset: number;
}

/** Must match RESET_PHRASE on the server, which checks it again. */
const PHRASE = 'DELETE ALL TRANSACTIONS';

/**
 * Starting the books fresh.
 *
 * The only screen in the app that permanently destroys records, so it is built
 * to be hard to do by accident and impossible to do by surprise: it says how
 * many rows will go before you start, lists exactly what survives, and will
 * not enable the button until the phrase is typed out in full. No amount of
 * clicking through gets you there.
 */
export function ResetDataCard() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const preview = useQuery({
    queryKey: ['system', 'reset-preview'],
    queryFn: ({ signal }) => api.get<ResetPreview>('/system/reset-preview', undefined, signal),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ResetSummary>('/system/reset-transactions', { confirmation: typed.trim() }),
    onSuccess: (result) => {
      // Everything downstream of a transaction is now wrong, including the
      // navigation badges, so the whole cache goes rather than a list of keys
      // that would need updating every time a screen is added.
      void queryClient.invalidateQueries();
      toast.success(
        'Transaction data cleared',
        result.transactionsRemoved +
          ' orders and ' +
          result.paymentsRemoved +
          ' payments removed. O.R. numbering starts again at 1.',
      );
      setTyped('');
      setOpen(false);
    },
    onError: (error) => toast.error('Could not clear the data', errorMessage(error)),
  });

  const counts = preview.data;
  const armed = typed.trim() === PHRASE;

  return (
    <>
      <Card className="border border-red-200">
        <CardHeader
          title="Reset data"
          subtitle="Clear the trading history and start the books from scratch."
        />
        <CardBody className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              This permanently deletes every transaction and payment. It cannot be undone, and
              there is no copy kept.{' '}
              {counts ? (
                <strong className="tnum">
                  {counts.transactions} orders and {counts.payments} payments would go.
                </strong>
              ) : null}
            </p>
          </div>

          <div className="text-sm text-slate-600">
            <p className="font-medium text-navy-900">What stays:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Customers, with their totals reset to zero</li>
              <li>Services and prices</li>
              <li>Inventory, expenses and gas records</li>
              <li>Loyalty points, which are already promised to customers</li>
              <li>Accounts, settings and the audit log</li>
            </ul>
          </div>

          <Button
            variant="danger"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setOpen(true)}
            className="w-full sm:w-auto"
          >
            Reset transaction data
          </Button>
        </CardBody>
      </Card>

      <Modal
        open={open}
        onClose={() => {
          setTyped('');
          setOpen(false);
        }}
        title="Clear all transactions?"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setTyped('');
                setOpen(false);
              }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={mutation.isPending}
              disabled={!armed}
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => mutation.mutate()}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            {counts ? (
              <>
                <strong className="tnum">{counts.transactions}</strong> orders and{' '}
                <strong className="tnum">{counts.payments}</strong> payments will be deleted, and{' '}
                <strong className="tnum">{counts.customers}</strong> customer totals reset to zero.
              </>
            ) : (
              'Every transaction and payment will be deleted.'
            )}{' '}
            O.R. numbering starts again at 1.
          </p>

          <Input
            label={'Type ' + PHRASE + ' to confirm'}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={PHRASE}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />

          <p className="text-xs text-slate-500">
            Consider making a copy of the spreadsheet first — File &rsaquo; Make a copy in Google
            Sheets. Once this runs there is nothing to restore from.
          </p>
        </div>
      </Modal>
    </>
  );
}
