import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Gift, Plus, Sparkles } from 'lucide-react';
import { REWARD_TYPES, type RewardType } from '@shared/constants';
import type { CustomerDto, LoyaltyBalanceDto, LoyaltyEntryDto, RewardDto } from '@shared/types';
import { CustomerPicker } from '@/components/CustomerPicker';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/auth/AuthProvider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { peso } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';

/**
 * Points and what they buy.
 *
 * Two halves: look a customer up and spend their points, which is what the
 * counter does all day, and maintain the reward list, which the owner does
 * occasionally. The counter half comes first on the page for that reason.
 */

function RewardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<RewardType>('Discount');
  const [pointsCost, setPointsCost] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/loyalty/rewards', {
        name: name.trim(),
        type,
        pointsCost: Number(pointsCost || 0),
        discountAmount: type === 'Discount' ? Number(discountAmount || 0) : undefined,
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      toast.success('Reward added');
      setName('');
      setPointsCost('');
      setDiscountAmount('');
      setDescription('');
      onClose();
    },
    onError: (error) => toast.error('Could not add the reward', errorMessage(error)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a reward"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={name.trim().length < 2 || !pointsCost}
            onClick={() => mutation.mutate()}
          >
            Add reward
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. ₱50 off a wash"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value as RewardType)}
          >
            {REWARD_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
          <Input
            label="Points cost"
            required
            type="number"
            inputMode="numeric"
            min={1}
            value={pointsCost}
            onChange={(event) => setPointsCost(event.target.value)}
          />
        </div>
        {type === 'Discount' ? (
          <Input
            label="Discount amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={discountAmount}
            onChange={(event) => setDiscountAmount(event.target.value)}
            placeholder="0.00"
          />
        ) : null}
        <Textarea
          label="Description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
    </Modal>
  );
}

export default function Loyalty() {
  useDocumentTitle('Loyalty');
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { can } = useAuth();
  const [selected, setSelected] = useState<CustomerDto | null>(null);
  const [rewardOpen, setRewardOpen] = useState(false);
  const customerId = selected?.customerId ?? '';

  const rewards = useQuery({
    queryKey: ['loyalty', 'rewards'],
    queryFn: ({ signal }) =>
      api.get<{ items: RewardDto[] }>('/loyalty/rewards', undefined, signal),
    staleTime: 5 * 60_000,
  });

  const account = useQuery({
    queryKey: ['loyalty', 'account', customerId],
    queryFn: ({ signal }) =>
      api.get<{ balance: LoyaltyBalanceDto; entries: LoyaltyEntryDto[] }>(
        '/loyalty/' + customerId,
        undefined,
        signal,
      ),
    enabled: Boolean(customerId),
    staleTime: 15_000,
  });

  const redeem = useMutation({
    mutationFn: (rewardId: string) => api.post('/loyalty/redeem', { customerId, rewardId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      toast.success('Reward redeemed');
    },
    onError: (error) => toast.error('Could not redeem that', errorMessage(error)),
  });

  const balance = account.data?.balance;

  return (
    <>
      <PageHeader
        title="Loyalty"
        subtitle="Look a customer up, see their points, and spend them."
        actions={
          can('loyalty.manage') ? (
            <Button
              size="sm"
              onClick={() => setRewardOpen(true)}
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              Add reward
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Customer" subtitle="Search by name, number or customer ID." />
            <CardBody>
              <CustomerPicker
                selected={selected}
                onSelect={setSelected}
                draft={null}
                onDraftChange={() => {
                  /* Registering a new customer belongs at the till, not here. */
                }}
              />
            </CardBody>
          </Card>

          {customerId ? (
            account.isLoading ? (
              <Skeleton className="mt-4 h-40 rounded-xl" />
            ) : account.isError ? (
              <Card className="mt-4">
                <ErrorState
                  title="Could not load that account"
                  message={errorMessage(account.error)}
                  onRetry={() => void account.refetch()}
                />
              </Card>
            ) : balance ? (
              <>
                <Card className="mt-4">
                  <CardBody>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-navy-900">{balance.customerName}</p>
                        <p className="text-sm text-slate-500 tnum">
                          {balance.lifetimeEarned} earned · {balance.lifetimeRedeemed} spent
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Points
                        </p>
                        <p className="text-3xl font-bold text-brand-600 tnum">{balance.balance}</p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Can redeem now
                      </p>
                      {balance.affordable.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          Not enough points for any reward yet.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {balance.affordable.map((reward) => (
                            <Button
                              key={reward.rewardId}
                              size="sm"
                              variant="secondary"
                              loading={redeem.isPending}
                              disabled={!can('loyalty.redeem')}
                              icon={<Gift className="h-4 w-4" aria-hidden="true" />}
                              onClick={() => {
                                void (async () => {
                                  const ok = await confirm({
                                    title: 'Redeem ' + reward.name + '?',
                                    confirmLabel: 'Redeem',
                                    message: (
                                      <>
                                        This takes <strong>{reward.pointsCost} points</strong> from{' '}
                                        {balance.customerName}, leaving{' '}
                                        {balance.balance - reward.pointsCost}.
                                      </>
                                    ),
                                  });
                                  if (ok) redeem.mutate(reward.rewardId);
                                })();
                              }}
                            >
                              {reward.name} · {reward.pointsCost}pt
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardBody>
                </Card>

                <Card className="mt-4">
                  <CardHeader title="Points history" />
                  {(account.data?.entries.length ?? 0) === 0 ? (
                    <EmptyState title="No points activity yet." />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {account.data?.entries.map((entry) => (
                        <li
                          key={entry.entryId}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-navy-800">{entry.reason}</span>
                            <span className="block text-xs text-slate-500 tnum">
                              {new Date(entry.entryDate).toLocaleDateString('en-PH')}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'shrink-0 font-semibold tnum',
                              entry.points >= 0 ? 'text-emerald-700' : 'text-red-600',
                            )}
                          >
                            {entry.points > 0 ? '+' : ''}
                            {entry.points}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            ) : null
          ) : (
            <Card className="mt-4">
              <EmptyState
                icon={<Sparkles className="h-6 w-6" aria-hidden="true" />}
                title="Pick a customer."
                message="Their points balance and what it can buy will appear here."
              />
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Rewards" subtitle="What points can be spent on." />
          {rewards.isLoading ? (
            <CardBody>
              <Skeleton className="h-24 rounded-lg" />
            </CardBody>
          ) : (rewards.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Gift className="h-6 w-6" aria-hidden="true" />}
              title="No rewards yet."
              message="Add what points can be exchanged for."
              action={
                can('loyalty.manage') ? (
                  <Button size="sm" onClick={() => setRewardOpen(true)}>
                    Add a reward
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {rewards.data?.items.map((reward) => (
                <li key={reward.rewardId} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-navy-900">{reward.name}</span>
                    <span className="shrink-0 text-sm font-semibold text-brand-600 tnum">
                      {reward.pointsCost}pt
                    </span>
                  </div>
                  {reward.description ? (
                    <p className="mt-0.5 text-xs text-slate-500">{reward.description}</p>
                  ) : null}
                  {reward.type === 'Discount' && reward.discountAmount > 0 ? (
                    <p className="mt-0.5 text-xs text-slate-500 tnum">
                      {peso(reward.discountAmount)} off
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {confirmDialog}
      <RewardDialog open={rewardOpen} onClose={() => setRewardOpen(false)} />
    </>
  );
}
