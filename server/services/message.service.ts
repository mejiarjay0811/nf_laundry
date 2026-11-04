import {
  COUNTER_KEYS,
  LIMITS,
  MESSAGE_TEMPLATES,
  SETTINGS_KEYS,
  SHEETS,
  type MessageStatus,
} from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import type { MessageDto, Paginated, SessionUser } from '../../shared/types.js';
import { badRequest, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';
import { getSetting } from './settings.service.js';

/**
 * Outbound SMS, written down before it is sent.
 *
 * Every message is queued as a row first and only then handed to a provider.
 * Sending is a third-party HTTP call that can be slow, rate-limited or simply
 * down, and a customer's "your laundry is ready" text failing must never be
 * what stops an order from being marked ready. Queue, then try; a failure
 * leaves a row saying what was meant to go out and why it did not.
 *
 * No provider is wired in. Which gateway a Philippine shop uses — Semaphore,
 * iTexMo, a Globe or Smart business plan — is their commercial decision, and
 * each needs an account and credentials that cannot be invented here. The seam
 * is `deliverViaProvider` below: give it a key in Settings and the queue
 * drains. Until then messages accumulate as Queued, which is honest, visible,
 * and costs nothing.
 */

export type TemplateKey = (typeof MESSAGE_TEMPLATES)[keyof typeof MESSAGE_TEMPLATES];

function toMessageDto(row: RowView): MessageDto {
  return {
    messageId: row.get('Message ID'),
    channel: row.get('Channel') || 'SMS',
    template: row.get('Template'),
    customerId: row.get('Customer ID'),
    contactNumber: row.get('Contact Number'),
    body: row.get('Body'),
    status: (row.get('Status') || 'Queued') as MessageStatus,
    transactionId: row.get('Transaction ID'),
    providerReference: row.get('Provider Reference'),
    error: row.get('Error'),
    attempts: row.num('Attempts'),
    queuedAt: row.get('Queued At'),
    sentAt: row.get('Sent At'),
    createdBy: row.get('Created By'),
  };
}

/**
 * Philippine mobile numbers, in the form a local gateway expects.
 *
 * 09171234567 and +639171234567 are the same number written two ways, and
 * customers give both. Anything that is not recognisably a PH mobile is left
 * exactly as typed rather than mangled into something that would fail
 * silently at the gateway.
 */
export function normalisePhNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('09')) return '+63' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('639')) return '+' + digits;
  if (digits.length === 10 && digits.startsWith('9')) return '+63' + digits;
  return raw.trim();
}

const BODIES: Record<string, (vars: Record<string, string>) => string> = {
  [MESSAGE_TEMPLATES.orderReceived]: (v) =>
    `${v.shop}: Hi ${v.name}, we have your laundry. O.R. ${v.or}. Ready by ${v.ready}. Salamat!`,
  [MESSAGE_TEMPLATES.readyForPickup]: (v) =>
    `${v.shop}: Hi ${v.name}, your laundry (O.R. ${v.or}) is ready for pickup. Salamat!`,
  [MESSAGE_TEMPLATES.balanceReminder]: (v) =>
    `${v.shop}: Hi ${v.name}, a balance of PHP ${v.balance} is outstanding on O.R. ${v.or}. Salamat!`,
};

export function renderTemplate(template: string, vars: Record<string, string>): string {
  const build = BODIES[template];
  const body = build ? build(vars) : '';
  return body.slice(0, LIMITS.maxSmsLength);
}

/* ------------------------------------------------------------- reading */

export async function listMessages(query: {
  page: number;
  pageSize: number;
  status?: string;
}): Promise<Paginated<MessageDto>> {
  const table = await getStore().table(SHEETS.messages);
  const rows = table.rows
    .filter((row) => !query.status || row.get('Status') === query.status)
    .sort((a, b) => b.get('Queued At').localeCompare(a.get('Queued At')));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: rows.slice(start, start + query.pageSize).map(toMessageDto),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / query.pageSize)),
  };
}

/* ------------------------------------------------------------- writing */

export async function queueMessage(
  input: {
    template: string;
    contactNumber: string;
    body?: string;
    vars?: Record<string, string>;
    customerId?: string;
    transactionId?: string;
  },
  actor: SessionUser | null,
): Promise<MessageDto | null> {
  const number = normalisePhNumber(input.contactNumber ?? '');
  // No number is not an error. Plenty of walk-ins never leave one, and the
  // order should still complete without a failed message hanging off it.
  if (!number || number.replace(/\D/g, '').length < 10) return null;

  const body = (input.body ?? renderTemplate(input.template, input.vars ?? {})).trim();
  if (!body) return null;

  const messageId = await nextEntityId(
    COUNTER_KEYS.messageId,
    'MSG-',
    SHEETS.messages,
    'Message ID',
    6,
  );
  const timestamp = manilaIso();

  await getStore().appendRecords(SHEETS.messages, [
    {
      'Message ID': messageId,
      Channel: 'SMS',
      Template: input.template,
      'Customer ID': normaliseText(input.customerId, 20),
      'Contact Number': number,
      Body: body.slice(0, LIMITS.maxSmsLength),
      Status: 'Queued',
      'Transaction ID': normaliseText(input.transactionId, 24),
      'Provider Reference': '',
      Error: '',
      Attempts: '0',
      'Queued At': timestamp,
      'Sent At': '',
      'Created By': actor?.username ?? 'system',
    },
  ]);

  const table = await getStore().table(SHEETS.messages, { fresh: true });
  const created = table.rows.find((row) => row.get('Message ID') === messageId);
  return created ? toMessageDto(created) : null;
}

/**
 * Queue a message without ever letting it break the caller.
 *
 * Used from the sale and status paths. The shop's work is the order; the text
 * is a nicety on top of it.
 */
export async function queueQuietly(
  input: Parameters<typeof queueMessage>[0],
  actor: SessionUser | null,
): Promise<void> {
  try {
    await queueMessage(input, actor);
  } catch (error) {
    logger.warn('Could not queue SMS', {
      template: input.template,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Hand queued messages to the gateway.
 *
 * Returns what it did rather than throwing, because this is run from a button
 * and from a schedule, and both want a count rather than an exception.
 */
export async function flushQueue(
  limit: number,
  actor: SessionUser,
): Promise<{ sent: number; failed: number; skipped: number; reason?: string }> {
  const provider = (await getSetting(SETTINGS_KEYS.smsProvider, '')).trim();
  if (!provider) {
    const pending = await listMessages({ page: 1, pageSize: 1, status: 'Queued' });
    return {
      sent: 0,
      failed: 0,
      skipped: pending.total,
      reason:
        'No SMS provider is configured. Set one in Settings and the queued messages will go out.',
    };
  }

  return withNamedLock('messages:flush', async () => {
    const table = await getStore().table(SHEETS.messages, { fresh: true });
    const queued = table.rows
      .filter((row) => row.get('Status') === 'Queued')
      .slice(0, Math.max(1, Math.min(limit, 50)));

    let sent = 0;
    let failed = 0;

    for (const row of queued) {
      const timestamp = manilaIso();
      const attempts = row.num('Attempts') + 1;
      try {
        const reference = await deliverViaProvider(provider, {
          to: row.get('Contact Number'),
          body: row.get('Body'),
        });
        await getStore().updateRecord(SHEETS.messages, row, {
          Status: 'Sent',
          'Provider Reference': reference,
          'Sent At': timestamp,
          Attempts: String(attempts),
          Error: '',
        });
        sent += 1;
      } catch (error) {
        await getStore().updateRecord(SHEETS.messages, row, {
          // Three strikes, then it stops costing a round trip every flush.
          Status: attempts >= 3 ? 'Failed' : 'Queued',
          Attempts: String(attempts),
          Error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        });
        failed += 1;
      }
    }

    if (sent > 0 || failed > 0) {
      await recordAudit({
        actor,
        action: 'MESSAGE_SEND',
        module: 'Messages',
        entityId: 'flush',
        newValue: { sent, failed },
      });
    }

    return { sent, failed, skipped: 0 };
  });
}

/**
 * The gateway seam.
 *
 * Deliberately unimplemented. Wiring a specific provider needs an account,
 * credentials and a sender name registered with that provider, none of which
 * can be guessed — and a half-written integration that silently drops messages
 * would be worse than one that says plainly it is not set up. The shape is
 * here so adding Semaphore or iTexMo is one function body and a script
 * property.
 */
async function deliverViaProvider(
  provider: string,
  _message: { to: string; body: string },
): Promise<string> {
  throw new Error(
    'SMS provider "' +
      provider +
      '" is named in Settings but no gateway is wired up yet. ' +
      'Add its API call in server/services/message.service.ts.',
  );
}

export async function cancelMessage(messageId: string, actor: SessionUser): Promise<MessageDto> {
  const table = await getStore().table(SHEETS.messages, { fresh: true });
  const row = table.rows.find((entry) => entry.get('Message ID') === messageId);
  if (!row) throw notFound('Message');
  if (row.get('Status') === 'Sent') throw badRequest('That message has already gone out.');

  await getStore().updateRecord(SHEETS.messages, row, { Status: 'Cancelled' });
  await recordAudit({
    actor,
    action: 'MESSAGE_QUEUE',
    module: 'Messages',
    entityId: messageId,
    newValue: { status: 'Cancelled' },
  });

  const updated = (await getStore().table(SHEETS.messages, { fresh: true })).rows.find(
    (entry) => entry.get('Message ID') === messageId,
  );
  if (!updated) throw notFound('Message');
  return toMessageDto(updated);
}
