import {
  COUNTER_KEYS,
  LIMITS,
  SETTINGS_KEYS,
  SHEETS,
  type LoyaltyType,
  type RewardType,
} from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type {
  LoyaltyBalanceDto,
  LoyaltyEntryDto,
  RewardDto,
  SessionUser,
} from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';
import { getNumericSetting } from './settings.service.js';

/**
 * Points, kept as a ledger rather than a balance.
 *
 * A stored balance that disagrees with its own history cannot be argued with
 * at the counter — the customer says they had 400 points, the column says 150,
 * and there is nothing to look at. Summing rows means every number on screen
 * can be walked back to the sale that created it.
 *
 * Each row also carries the balance *after* it, which is redundant on purpose:
 * it makes a statement readable straight off the spreadsheet, and it is how a
 * mis-posted entry gets spotted.
 */

function toEntryDto(row: RowView): LoyaltyEntryDto {
  return {
    entryId: row.get('Entry ID'),
    customerId: row.get('Customer ID'),
    customerName: row.get('Customer Name'),
    type: (row.get('Type') || 'Earned') as LoyaltyType,
    points: row.num('Points'),
    balanceAfter: row.num('Balance After'),
    transactionId: row.get('Transaction ID'),
    rewardId: row.get('Reward ID'),
    reason: row.get('Reason'),
    recordedBy: row.get('Recorded By'),
    entryDate: row.get('Entry Date'),
    expiresAt: row.get('Expires At'),
  };
}

function toRewardDto(row: RowView): RewardDto {
  return {
    rewardId: row.get('Reward ID'),
    name: row.get('Name'),
    description: row.get('Description'),
    type: (row.get('Type') || 'Discount') as RewardType,
    pointsCost: row.num('Points Cost'),
    discountAmount: row.num('Discount Amount'),
    serviceId: row.get('Service ID'),
    status: row.get('Status') === 'Inactive' ? 'Inactive' : 'Active',
    sortOrder: row.num('Sort Order'),
  };
}

/**
 * Entries that still count.
 *
 * An expired row stops counting on its date without anything having to run on
 * a schedule — there is no cron in a spreadsheet, and a nightly job nobody
 * notices has stopped is worse than a comparison done at read time.
 */
async function liveEntries(customerId?: string): Promise<RowView[]> {
  const table = await getStore().table(SHEETS.loyalty);
  const today = manilaIso();
  return table.rows.filter((row) => {
    if (row.get('Status') !== 'Active') return false;
    if (customerId && row.get('Customer ID') !== customerId) return false;
    const expires = row.get('Expires At');
    if (expires && expires < today) return false;
    return true;
  });
}

export async function balanceFor(customerId: string): Promise<number> {
  const entries = await liveEntries(customerId);
  return entries.reduce((sum, row) => sum + row.num('Points'), 0);
}

export async function listRewards(includeInactive = false): Promise<RewardDto[]> {
  const table = await getStore().table(SHEETS.rewards);
  return table.rows
    .map(toRewardDto)
    .filter((reward) => includeInactive || reward.status === 'Active')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.pointsCost - b.pointsCost);
}

export async function loyaltyBalance(customerId: string): Promise<LoyaltyBalanceDto> {
  const customers = await getStore().table(SHEETS.customers);
  const customer = customers.rows.find((row) => row.get('Customer ID') === customerId);
  if (!customer) throw notFound('Customer');

  const entries = await liveEntries(customerId);
  const balance = entries.reduce((sum, row) => sum + row.num('Points'), 0);
  const lifetimeEarned = entries
    .filter((row) => row.num('Points') > 0)
    .reduce((sum, row) => sum + row.num('Points'), 0);
  const rewards = await listRewards();

  return {
    customerId,
    customerName: customer.get('Full Name'),
    balance,
    lifetimeEarned,
    lifetimeRedeemed: lifetimeEarned - balance,
    affordable: rewards.filter((reward) => reward.pointsCost <= balance),
  };
}

export async function listEntries(customerId: string, limit = 50): Promise<LoyaltyEntryDto[]> {
  const table = await getStore().table(SHEETS.loyalty);
  return table.rows
    .filter((row) => row.get('Customer ID') === customerId && row.get('Status') === 'Active')
    .sort((a, b) => b.get('Entry Date').localeCompare(a.get('Entry Date')))
    .slice(0, limit)
    .map(toEntryDto);
}

/* ------------------------------------------------------------- writing */

async function appendEntry(
  input: {
    customerId: string;
    customerName: string;
    type: LoyaltyType;
    points: number;
    transactionId?: string;
    rewardId?: string;
    reason: string;
    expiresAt?: string;
  },
  actor: SessionUser,
): Promise<LoyaltyEntryDto> {
  const entryId = await nextEntityId(
    COUNTER_KEYS.loyaltyId,
    'LYL-',
    SHEETS.loyalty,
    'Entry ID',
    6,
  );
  const balanceAfter = (await balanceFor(input.customerId)) + input.points;
  const timestamp = manilaIso();

  await getStore().appendRecords(SHEETS.loyalty, [
    {
      'Entry ID': entryId,
      'Customer ID': input.customerId,
      'Customer Name': input.customerName,
      Type: input.type,
      Points: String(input.points),
      'Balance After': String(balanceAfter),
      'Transaction ID': input.transactionId ?? '',
      'Reward ID': input.rewardId ?? '',
      Reason: normaliseText(input.reason, 160),
      'Recorded By': actor.username,
      'Entry Date': timestamp,
      'Expires At': input.expiresAt ?? '',
      Status: 'Active',
      'Created At': timestamp,
    },
  ]);

  const table = await getStore().table(SHEETS.loyalty, { fresh: true });
  const created = table.rows.find((row) => row.get('Entry ID') === entryId);
  if (!created) throw notFound('Loyalty entry');
  return toEntryDto(created);
}

/**
 * Points for a completed sale.
 *
 * Called from the sale path, and deliberately swallowing its own failures:
 * points are a courtesy, and a loyalty write that goes wrong must never be
 * what stops a sale from being recorded. The sale is the thing the shop is
 * owed money for; the points can be added by hand afterwards.
 */
export async function earnForSale(
  input: {
    customerId: string;
    customerName: string;
    transactionId: string;
    amountPaid: number;
  },
  actor: SessionUser,
): Promise<LoyaltyEntryDto | null> {
  if (!input.customerId) return null;

  try {
    const pesosPerPoint = await getNumericSetting(SETTINGS_KEYS.loyaltyPesosPerPoint, 0);
    if (pesosPerPoint <= 0) return null;

    const points = Math.floor(toPesos(toCentavos(input.amountPaid)) / pesosPerPoint);
    if (points <= 0) return null;

    return await appendEntry(
      {
        customerId: input.customerId,
        customerName: input.customerName,
        type: 'Earned',
        points,
        transactionId: input.transactionId,
        reason: 'Earned on sale',
      },
      actor,
    );
  } catch {
    return null;
  }
}

export async function redeemReward(
  input: { customerId: string; rewardId: string; transactionId?: string },
  actor: SessionUser,
): Promise<{ entry: LoyaltyEntryDto; reward: RewardDto; balance: number }> {
  return withNamedLock('loyalty:write', async () => {
    const rewards = await listRewards(true);
    const reward = rewards.find((entry) => entry.rewardId === input.rewardId);
    if (!reward) throw notFound('Reward');
    if (reward.status !== 'Active') throw conflict('That reward is no longer offered.');

    const balance = await loyaltyBalance(input.customerId);
    if (balance.balance < reward.pointsCost) {
      throw conflict(
        balance.customerName +
          ' has ' +
          balance.balance +
          ' points. That reward needs ' +
          reward.pointsCost +
          '.',
      );
    }

    const entry = await appendEntry(
      {
        customerId: input.customerId,
        customerName: balance.customerName,
        type: 'Redeemed',
        points: -reward.pointsCost,
        transactionId: input.transactionId,
        rewardId: reward.rewardId,
        reason: 'Redeemed: ' + reward.name,
      },
      actor,
    );

    await recordAudit({
      actor,
      action: 'LOYALTY_REDEEM',
      module: 'Loyalty',
      entityId: entry.entryId,
      newValue: { customerId: input.customerId, reward: reward.name, points: reward.pointsCost },
    });

    return { entry, reward, balance: balance.balance - reward.pointsCost };
  });
}

/** A manual correction — a goodwill gesture, or fixing a mis-post. */
export async function adjustPoints(
  input: { customerId: string; points: number; reason: string },
  actor: SessionUser,
): Promise<LoyaltyEntryDto> {
  const points = Math.trunc(Number(input.points));
  if (!Number.isFinite(points) || points === 0) {
    throw badRequest('Enter the points to add or take away.');
  }
  if (Math.abs(points) > LIMITS.maxLoyaltyPoints) throw badRequest('That is out of range.');

  const reason = normaliseText(input.reason, 160);
  if (reason.length < 3) throw badRequest('Give a reason for the adjustment.');

  return withNamedLock('loyalty:write', async () => {
    const balance = await loyaltyBalance(input.customerId);
    if (balance.balance + points < 0) {
      throw conflict('That would take the balance below zero.');
    }

    const entry = await appendEntry(
      {
        customerId: input.customerId,
        customerName: balance.customerName,
        type: 'Adjusted',
        points,
        reason,
      },
      actor,
    );

    await recordAudit({
      actor,
      action: 'LOYALTY_ADJUST',
      module: 'Loyalty',
      entityId: entry.entryId,
      newValue: { customerId: input.customerId, points, reason },
    });

    return entry;
  });
}

/* ------------------------------------------------------------- rewards */

export async function createReward(
  input: {
    name: string;
    description?: string;
    type: RewardType;
    pointsCost: number;
    discountAmount?: number;
    serviceId?: string;
    sortOrder?: number;
  },
  actor: SessionUser,
): Promise<RewardDto> {
  const name = normaliseText(input.name, 60);
  if (name.length < 2) throw badRequest('Give the reward a name.');

  const pointsCost = Math.trunc(Number(input.pointsCost));
  if (!Number.isFinite(pointsCost) || pointsCost <= 0) {
    throw badRequest('Set how many points the reward costs.');
  }

  return withNamedLock('loyalty:rewards', async () => {
    const rewardId = await nextEntityId(
      COUNTER_KEYS.rewardId,
      'RWD-',
      SHEETS.rewards,
      'Reward ID',
      4,
    );
    const timestamp = manilaIso();

    await getStore().appendRecords(SHEETS.rewards, [
      {
        'Reward ID': rewardId,
        Name: name,
        Description: normaliseText(input.description, 160),
        Type: input.type,
        'Points Cost': String(pointsCost),
        'Discount Amount': toPesos(toCentavos(Number(input.discountAmount) || 0)).toFixed(2),
        'Service ID': normaliseText(input.serviceId, 20),
        Status: 'Active',
        'Sort Order': String(Math.max(0, Number(input.sortOrder) || 0)),
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'REWARD_CREATE',
      module: 'Loyalty',
      entityId: rewardId,
      newValue: { name, pointsCost },
    });

    const created = (await listRewards(true)).find((reward) => reward.rewardId === rewardId);
    if (!created) throw notFound('Reward');
    return created;
  });
}

export async function updateReward(
  rewardId: string,
  input: {
    name?: string;
    description?: string;
    pointsCost?: number;
    discountAmount?: number;
    status?: 'Active' | 'Inactive';
    sortOrder?: number;
  },
  actor: SessionUser,
): Promise<RewardDto> {
  return withNamedLock('loyalty:rewards', async () => {
    const table = await getStore().table(SHEETS.rewards, { fresh: true });
    const row = table.rows.find((entry) => entry.get('Reward ID') === rewardId);
    if (!row) throw notFound('Reward');

    const patch: Record<string, string> = { 'Updated At': manilaIso() };
    if (input.name !== undefined) patch.Name = normaliseText(input.name, 60);
    if (input.description !== undefined) {
      patch.Description = normaliseText(input.description, 160);
    }
    if (input.pointsCost !== undefined) {
      patch['Points Cost'] = String(Math.max(1, Math.trunc(Number(input.pointsCost) || 1)));
    }
    if (input.discountAmount !== undefined) {
      patch['Discount Amount'] = toPesos(toCentavos(Number(input.discountAmount) || 0)).toFixed(2);
    }
    if (input.status !== undefined) patch.Status = input.status;
    if (input.sortOrder !== undefined) {
      patch['Sort Order'] = String(Math.max(0, Number(input.sortOrder) || 0));
    }

    await getStore().updateRecord(SHEETS.rewards, row, patch);
    await recordAudit({
      actor,
      action: 'REWARD_UPDATE',
      module: 'Loyalty',
      entityId: rewardId,
      newValue: input as Record<string, unknown>,
    });

    const updated = (await listRewards(true)).find((reward) => reward.rewardId === rewardId);
    if (!updated) throw notFound('Reward');
    return updated;
  });
}
