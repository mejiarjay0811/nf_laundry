import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Database, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { SETTINGS_KEYS } from '@shared/constants';
import type { HealthStatus, SettingsDto } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ResetDataCard } from '@/components/ResetDataCard';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';

interface Diagnostics {
  provider: string;
  target: string;
  cache: { size: number; hits: number; misses: number };
  cacheTtlSeconds: number;
  workbook: { ready: boolean; present: string[]; missing: string[] };
  node: string;
  uptimeSeconds: number;
}

export default function Settings() {
  useDocumentTitle('Settings');
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<SettingsDto>({});

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => api.get<{ settings: SettingsDto }>('/settings', undefined, signal),
    staleTime: 60_000,
  });

  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.get<HealthStatus>('/system/health', undefined, signal),
    retry: false,
  });

  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: ({ signal }) => api.get<Diagnostics>('/system/diagnostics', undefined, signal),
    retry: false,
  });

  useEffect(() => {
    if (query.data?.settings) setDraft(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (patch: SettingsDto) => api.patch<{ settings: SettingsDto }>('/settings', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved');
    },
    onError: (error) => toast.error('Unable to save settings', errorMessage(error)),
  });

  const initialise = useMutation({
    mutationFn: () => api.post('/system/initialise'),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success('Workbook verified', 'Missing sheets and headers were repaired.');
    },
    onError: (error) => toast.error('Unable to verify the workbook', errorMessage(error)),
  });

  const refreshCache = useMutation({
    mutationFn: () => api.post('/system/refresh-cache'),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success('Cache cleared', 'Fresh data will be read from the spreadsheet.');
    },
  });

  const set = (key: string, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const field = (key: string) => draft[key] ?? '';

  /*
   * Whether anything has actually been changed.
   *
   * This page is a long form — well over two screens on a phone — and the save
   * button used to sit only at the very top of it. Editing the discount limit
   * at the bottom meant scrolling all the way back up to commit it, which is
   * easy to read as the page simply not working. A bar appears at the foot of
   * the screen as soon as something is edited, so saving is always in reach.
   */
  const saved = query.data?.settings ?? {};
  const dirtyKeys = Object.keys(draft).filter((key) => draft[key] !== saved[key]);
  const isDirty = dirtyKeys.length > 0;

  if (query.isError) {
    return (
      <div className="card">
        <ErrorState title="Unable to load settings" onRetry={() => void query.refetch()} />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Business details, receipts, numbering and operations."
        actions={
          <Button
            size="sm"
            loading={save.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Save these settings?',
                confirmLabel: 'Save changes',
                message:
                  'These apply across the whole app — receipts, numbering and turnaround times.',
              });
              if (ok) save.mutate(draft);
            }}
            icon={<Save className="h-4 w-4" aria-hidden="true" />}
          >
            Save changes
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Business information" subtitle="Shown on receipts and reports." />
          <CardBody className="space-y-3">
            <Input
              label="Business name"
              value={field(SETTINGS_KEYS.businessName)}
              onChange={(event) => set(SETTINGS_KEYS.businessName, event.target.value)}
            />
            <Input
              label="Address"
              value={field(SETTINGS_KEYS.businessAddress)}
              onChange={(event) => set(SETTINGS_KEYS.businessAddress, event.target.value)}
            />
            <Input
              label="Contact number"
              value={field(SETTINGS_KEYS.businessContact)}
              onChange={(event) => set(SETTINGS_KEYS.businessContact, event.target.value)}
              inputMode="tel"
            />
            <Input
              label="Email"
              type="email"
              value={field(SETTINGS_KEYS.businessEmail)}
              onChange={(event) => set(SETTINGS_KEYS.businessEmail, event.target.value)}
            />
            <Input
              label="Logo URL"
              value={field(SETTINGS_KEYS.businessLogo)}
              onChange={(event) => set(SETTINGS_KEYS.businessLogo, event.target.value)}
              hint="Optional. Used on printed receipts where supported."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Receipt" subtitle="How the printed receipt reads." />
          <CardBody className="space-y-3">
            <Input
              label="Receipt header"
              value={field(SETTINGS_KEYS.receiptHeader)}
              onChange={(event) => set(SETTINGS_KEYS.receiptHeader, event.target.value)}
            />
            <Textarea
              label="Receipt footer"
              rows={2}
              value={field(SETTINGS_KEYS.receiptFooter)}
              onChange={(event) => set(SETTINGS_KEYS.receiptFooter, event.target.value)}
            />
            <Select
              label="Paper width"
              value={field(SETTINGS_KEYS.receiptPaperWidth) || '80mm'}
              onChange={(event) => set(SETTINGS_KEYS.receiptPaperWidth, event.target.value)}
              hint="58mm and 80mm match common thermal printers."
            >
              <option value="58mm">58 mm thermal</option>
              <option value="80mm">80 mm thermal</option>
              <option value="a4">Standard paper</option>
            </Select>
            <Select
              label="Show QR code"
              value={field(SETTINGS_KEYS.receiptShowQr) || 'true'}
              onChange={(event) => set(SETTINGS_KEYS.receiptShowQr, event.target.value)}
              hint="Encodes the transaction ID for quick lookup."
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Numbering" subtitle="Format of O.R. and transaction numbers." />
          <CardBody className="space-y-3">
            <Input
              label="O.R. prefix"
              value={field(SETTINGS_KEYS.orPrefix)}
              onChange={(event) => set(SETTINGS_KEYS.orPrefix, event.target.value)}
              hint="Current format example: OR-000042"
            />
            <Input
              label="O.R. digits"
              type="number"
              min={3}
              max={10}
              value={field(SETTINGS_KEYS.orPadding)}
              onChange={(event) => set(SETTINGS_KEYS.orPadding, event.target.value)}
            />
            <Input
              label="Transaction ID prefix"
              value={field(SETTINGS_KEYS.txnPrefix)}
              onChange={(event) => set(SETTINGS_KEYS.txnPrefix, event.target.value)}
              hint="Format: PREFIX-YYYYMMDD-0001"
            />
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
              Changing these affects new numbers only. Existing records keep the number they were
              issued.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Operations" subtitle="Turnaround and discount policy." />
          <CardBody className="space-y-3">
            {/* The usual wage, so recording payroll does not mean remembering
                the figure every time. The expense form offers it as a starting
                point and it stays editable, because a week is not always the
                same. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Staff salary"
                inputMode="decimal"
                value={field(SETTINGS_KEYS.staffSalary)}
                onChange={(event) => set(SETTINGS_KEYS.staffSalary, event.target.value)}
                leading={<span className="text-sm">{'\u20B1'}</span>}
                placeholder="0.00"
                hint="Offered when recording a Salary expense"
              />
              <Select
                label="Paid"
                value={field(SETTINGS_KEYS.staffSalaryPeriod) || 'Monthly'}
                onChange={(event) => set(SETTINGS_KEYS.staffSalaryPeriod, event.target.value)}
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Semi-monthly">Semi-monthly</option>
                <option value="Monthly">Monthly</option>
              </Select>
            </div>
            <Input
              label="Default turnaround (hours)"
              type="number"
              min={0}
              max={240}
              value={field(SETTINGS_KEYS.defaultTurnaroundHours)}
              onChange={(event) => set(SETTINGS_KEYS.defaultTurnaroundHours, event.target.value)}
              hint="Used to set the expected pickup date on new orders."
            />
            <Input
              label="Pickup alert after (days)"
              type="number"
              min={1}
              max={30}
              value={field(SETTINGS_KEYS.pickupSlaDays)}
              onChange={(event) => set(SETTINGS_KEYS.pickupSlaDays, event.target.value)}
              hint="Orders waiting longer than this raise an alert."
            />
            <Select
              label="Staff may apply discounts"
              value={field(SETTINGS_KEYS.allowStaffDiscount) || 'true'}
              onChange={(event) => set(SETTINGS_KEYS.allowStaffDiscount, event.target.value)}
            >
              <option value="true">Yes</option>
              <option value="false">No, administrators only</option>
            </Select>
            <Input
              label="Maximum staff discount"
              inputMode="decimal"
              value={field(SETTINGS_KEYS.maxStaffDiscount)}
              onChange={(event) => set(SETTINGS_KEYS.maxStaffDiscount, event.target.value)}
              leading={<span className="text-sm">{'\u20B1'}</span>}
              hint="Larger discounts require an administrator."
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Data source"
          subtitle="Connection to the Google Sheets workbook."
          action={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={refreshCache.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Clear the cached data?',
                    confirmLabel: 'Clear cache',
                    message:
                      'Everything will be read from the spreadsheet again. Nothing is deleted; the next few screens will simply be slower.',
                  });
                  if (ok) refreshCache.mutate();
                }}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              >
                Clear cache
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={initialise.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Verify and repair the workbook?',
                    confirmLabel: 'Verify workbook',
                    message:
                      'Missing sheets and column headings are recreated. Existing rows are never changed or removed.',
                  });
                  if (ok) initialise.mutate();
                }}
                icon={<Database className="h-4 w-4" aria-hidden="true" />}
              >
                Verify workbook
              </Button>
            </div>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Status</dt>
                <dd className="flex items-center gap-1.5 font-medium">
                  <span
                    className={
                      'h-2 w-2 rounded-full ' +
                      (health.data?.ok ? 'bg-emerald-500' : 'bg-amber-500')
                    }
                    aria-hidden="true"
                  />
                  {health.data?.ok ? 'Connected' : 'Needs attention'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Driver</dt>
                <dd className="font-medium">{diagnostics.data?.provider ?? '\u2014'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Round-trip latency</dt>
                <dd className="font-medium tnum">
                  {health.data?.latencyMs !== null && health.data?.latencyMs !== undefined
                    ? health.data.latencyMs + ' ms'
                    : '\u2014'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Cache TTL</dt>
                <dd className="font-medium tnum">
                  {diagnostics.data ? diagnostics.data.cacheTtlSeconds + ' s' : '\u2014'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Cached tables</dt>
                <dd className="font-medium tnum">{diagnostics.data?.cache.size ?? '\u2014'}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Worksheets
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(diagnostics.data?.workbook.present ?? []).map((sheet) => (
                  <span
                    key={sheet}
                    className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                  >
                    {sheet}
                  </span>
                ))}
                {(diagnostics.data?.workbook.missing ?? []).map((sheet) => (
                  <span
                    key={sheet}
                    className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20"
                  >
                    {sheet} (missing)
                  </span>
                ))}
              </div>
              {health.data && !health.data.ok ? (
                <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                  {health.data.message}
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-4 flex items-start gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Credentials live only in the server environment. The browser never receives a Google
            API key, service-account key or spreadsheet token.
          </p>
        </CardBody>
      </Card>

      {/* Last on the page on purpose: nothing below it to scroll past by
          accident, and well away from the fields people edit every week. */}
      <div className="mt-4">
        <ResetDataCard />
      </div>

      {/* Always within reach on a long form. */}
      {isDirty ? (
        <div className="sticky bottom-16 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-800 bg-navy-900 px-4 py-3 shadow-pop sm:bottom-4">
          <p className="text-sm text-white">
            <strong className="tnum">{dirtyKeys.length}</strong>{' '}
            {dirtyKeys.length === 1 ? 'change' : 'changes'} not saved
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-white"
              disabled={save.isPending}
              onClick={() => setDraft(query.data?.settings ?? {})}
            >
              Discard
            </Button>
            <Button
              size="sm"
              loading={save.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Save these settings?',
                  confirmLabel: 'Save changes',
                  message:
                    'These apply across the whole app — receipts, numbering and turnaround times.',
                });
                if (ok) save.mutate(draft);
              }}
              icon={<Save className="h-4 w-4" aria-hidden="true" />}
            >
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      {confirmDialog}
    </>
  );
}
