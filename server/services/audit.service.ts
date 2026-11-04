import { SHEETS } from '../../shared/constants.js';
import type { AuditAction, AuditModule } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import type { AuditLogDto, Paginated, SessionUser } from '../../shared/types.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { randomSuffix } from '../utils/ids.js';

export interface AuditEntry {
  actor: Pick<SessionUser, 'userId' | 'username'> | null;
  action: AuditAction | string;
  module: AuditModule | string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  sessionInfo?: string;
}

const MAX_VALUE_LENGTH = 900;

function serialise(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, MAX_VALUE_LENGTH);
  try {
    return JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
  } catch {
    return '[unserialisable]';
  }
}

/**
 * Append-only audit trail.
 *
 * Deliberately non-fatal: the audit row is written AFTER the business record is
 * already committed, so failing the user's request at that point would report a
 * false negative for work that actually succeeded. Failures are logged at error
 * level so they are visible in monitoring.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await getStore().appendRecords(SHEETS.auditLogs, [auditRecord(entry)]);
  } catch (error) {
    logger.error('Audit log write failed', { action: entry.action, ...errorMeta(error) });
  }
}

/**
 * The audit row on its own, for callers that write it alongside something else
 * so the pair can share one commit.
 */
export function auditRecord(entry: AuditEntry): Record<string, string> {
  return {
    'Log ID': 'LOG-' + Date.now().toString(36).toUpperCase() + '-' + randomSuffix(4),
    'User ID': entry.actor?.userId ?? '',
    Username: entry.actor?.username ?? 'system',
    Action: entry.action,
    Module: entry.module,
    'Entity ID': entry.entityId ?? '',
    'Previous Value': serialise(entry.previousValue),
    'New Value': serialise(entry.newValue),
    Timestamp: manilaIso(),
    'Session Info': entry.sessionInfo ?? '',
  };
}

function toDto(row: RowView): AuditLogDto {
  return {
    logId: row.get('Log ID'),
    userId: row.get('User ID'),
    username: row.get('Username'),
    action: row.get('Action'),
    module: row.get('Module'),
    entityId: row.get('Entity ID'),
    previousValue: row.get('Previous Value'),
    newValue: row.get('New Value'),
    timestamp: row.get('Timestamp'),
    sessionInfo: row.get('Session Info'),
  };
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  search?: string;
  action?: string;
  module?: string;
  username?: string;
  from?: string;
  to?: string;
}

export async function listAuditLogs(query: AuditQuery): Promise<Paginated<AuditLogDto>> {
  const store = getStore();
  const table = await store.table(SHEETS.auditLogs);
  const search = query.search?.toLowerCase().trim();

  let items = table.rows.map(toDto);

  if (query.action) items = items.filter((i) => i.action === query.action);
  if (query.module) items = items.filter((i) => i.module === query.module);
  if (query.username) {
    const needle = query.username.toLowerCase();
    items = items.filter((i) => i.username.toLowerCase().includes(needle));
  }
  if (query.from) items = items.filter((i) => i.timestamp.slice(0, 10) >= query.from!);
  if (query.to) items = items.filter((i) => i.timestamp.slice(0, 10) <= query.to!);
  if (search) {
    items = items.filter((i) =>
      [i.username, i.action, i.module, i.entityId, i.newValue, i.previousValue]
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(Math.max(1, query.page), totalPages);
  const start = (page - 1) * query.pageSize;

  return {
    items: items.slice(start, start + query.pageSize),
    page,
    pageSize: query.pageSize,
    total,
    totalPages,
  };
}

/** Distinct values for the audit filter dropdowns. */
export async function auditFacets(): Promise<{ actions: string[]; modules: string[]; users: string[] }> {
  const table = await getStore().table(SHEETS.auditLogs);
  const actions = new Set<string>();
  const modules = new Set<string>();
  const users = new Set<string>();
  for (const row of table.rows) {
    if (row.get('Action')) actions.add(row.get('Action'));
    if (row.get('Module')) modules.add(row.get('Module'));
    if (row.get('Username')) users.add(row.get('Username'));
  }
  return {
    actions: [...actions].sort(),
    modules: [...modules].sort(),
    users: [...users].sort(),
  };
}
