import { handleRpc, type HttpMethod } from '../server/api/router.js';
import { toErrorResult } from '../server/api/errorBody.js';
import { GuardMismatchError } from '../server/sheets/gateway.js';
import { initialiseWorkbook } from '../server/sheets/init.js';
import { setAttemptStore, type Attempt } from '../server/services/auth.service.js';
import { seedServices } from '../server/services/catalog.service.js';
import { seedSettings } from '../server/services/settings.service.js';
import {
  createUser,
  findUserByUsername,
  hasAnyUser,
  resetUserPassword,
} from '../server/services/user.service.js';
import { hashPassword, verifyPassword } from '../server/utils/password.js';
import { ROLES, type Role } from '../shared/constants.js';
import { PASSWORD_ITERATIONS } from '../shared/crypto.js';
import { NativeSheetsGateway } from './gateway.js';
import { getStore } from './store.js';
import { awaitSync, installSyncRuntime } from './syncPromise.js';

/**
 * The Apps Script deployment: the entire backend.
 *
 * Two request shapes arrive here.
 *
 *   { method, path, query, body, token }  the application itself, routed
 *                                         through the shared table in
 *                                         server/api/router.ts
 *
 *   { op, token, ... }                    low-level storage and maintenance
 *                                         calls from the command-line tools,
 *                                         which require the master API_TOKEN
 *
 * The app never carries the master token: it signs in with a username and
 * password and receives a session token, so nothing secret ships in the APK.
 */

declare const SpreadsheetApp: { getActiveSpreadsheet: () => { getName: () => string } };
declare const PropertiesService: {
  getScriptProperties: () => { getProperty: (key: string) => string | null };
};
declare const CacheService: {
  getScriptCache: () => {
    get: (key: string) => string | null;
    put: (key: string, value: string, seconds: number) => void;
    remove: (key: string) => void;
  };
};
declare const ContentService: {
  createTextOutput: (value: string) => { setMimeType: (type: unknown) => unknown };
  MimeType: { JSON: unknown };
};
declare const Utilities: { getUuid: () => string };

export const SCRIPT_VERSION = '12';

installSyncRuntime();

/* ------------------------------------------------------- login throttling */

const ATTEMPT_TTL_SECONDS = 20 * 60;

/**
 * Failed sign-in counts, kept in the script cache.
 *
 * Every request is a separate execution with its own memory, so an in-process
 * counter would reset on each attempt and the throttle would not exist. The
 * cache is shared across executions and expires entries by itself.
 */
setAttemptStore({
  get(key: string): Attempt | null {
    const raw = CacheService.getScriptCache().get('login:' + key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Attempt;
    } catch {
      return null;
    }
  },
  set(key: string, value: Attempt): void {
    CacheService.getScriptCache().put('login:' + key, JSON.stringify(value), ATTEMPT_TTL_SECONDS);
  },
  remove(key: string): void {
    CacheService.getScriptCache().remove('login:' + key);
  },
});

/* ------------------------------------------------------------- transport */

function json(value: unknown): unknown {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function ok(data: unknown): unknown {
  return json({ ok: true, data });
}

function fail(code: string, message: string): unknown {
  return json({ ok: false, error: { code, message } });
}

function masterToken(): string {
  return PropertiesService.getScriptProperties().getProperty('API_TOKEN') ?? '';
}

/* ------------------------------------------------------------ storage ops */

/**
 * The low-level operations the command-line tools use. They run against the
 * same gateway the application uses, so locking and validation are identical.
 */
function runStorageOp(op: string, payload: Record<string, unknown>): unknown {
  const gateway = new NativeSheetsGateway();

  switch (op) {
    case 'ping':
      return ok({
        spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
        sheets: awaitSync(gateway.listSheets()),
        version: SCRIPT_VERSION,
      });

    case 'listSheets':
      return ok(awaitSync(gateway.listSheets()));

    case 'ensureSheets':
      return ok(
        awaitSync(
          gateway.ensureSheets(
            (payload.definitions as Array<{ name: string; headers: string[] }>) ?? [],
          ),
        ),
      );

    case 'readTable':
      return ok(awaitSync(gateway.readTable(String(payload.sheet))));

    case 'readTables':
      return ok({ tables: awaitSync(gateway.readTables((payload.sheets as string[]) ?? [])) });

    case 'appendRows':
      return ok(
        awaitSync(gateway.appendRows(String(payload.sheet), (payload.rows as string[][]) ?? [])),
      );

    case 'appendMany':
      return ok({
        results: awaitSync(
          gateway.appendMany((payload.batch as Array<{ sheet: string; rows: string[][] }>) ?? []),
        ),
      });

    case 'updateRows': {
      const updates =
        (payload.updates as Array<{
          rowNumber: number;
          values: string[];
          guard?: { columnIndex: number; expected: string };
        }>) ?? [];
      awaitSync(gateway.updateRows(String(payload.sheet), updates));
      return ok({ updated: updates.length });
    }

    case 'bumpCounter':
      return ok({
        value: awaitSync(
          gateway.bumpCounter(
            String(payload.name),
            Number(payload.delta),
            Number(payload.seedIfMissing),
          ),
        ),
      });

    case 'bumpCounters':
      return ok({
        values: awaitSync(
          gateway.bumpCounters(
            (payload.requests as Array<{ name: string; delta: number; seedIfMissing: number }>) ??
              [],
          ),
        ),
      });

    case 'clearSheetData': {
      const sheet = String(payload.sheet);
      const result = awaitSync(
        gateway.clearSheetData(sheet, payload.confirm as 'DELETE_ALL_ROWS'),
      );
      return ok({ sheet, removed: result.removed });
    }

    /* ------------------------------------------------------- maintenance */

    /**
     * Set a password from the command line.
     *
     * Hashing has to happen here rather than on the developer's machine: the
     * pepper lives in this script's properties and never leaves it, so a hash
     * computed anywhere else could not be verified at sign-in.
     */
    case 'resetPassword': {
      const username = String(payload.username ?? '').trim();
      const password = String(payload.password ?? '');
      const record = awaitSync(findUserByUsername(username));
      if (!record) return fail('NOT_FOUND', 'No account named "' + username + '".');
      awaitSync(resetUserPassword(record.userId, password, null));
      return ok({ userId: record.userId, username: record.username });
    }

    /**
     * Create the first account from the command line.
     *
     * Defaults to Owner, not Admin. Administration and the business are
     * separate roles now, and an Admin can reach accounts, settings and the
     * audit log but not the till or the takings — so a shop whose only account
     * was an Admin could not actually run the shop. Pass `role` explicitly to
     * create the administrator alongside it.
     */
    case 'createAdmin': {
      const username = String(payload.username ?? '').trim();
      const existing = awaitSync(findUserByUsername(username));
      if (existing) return fail('CONFLICT', 'An account named "' + username + '" already exists.');
      const requested = String(payload.role ?? 'Owner');
      const role = (ROLES as readonly string[]).indexOf(requested) >= 0 ? requested : 'Owner';
      const created = awaitSync(
        createUser(
          {
            username,
            password: String(payload.password ?? ''),
            fullName: String(payload.fullName ?? 'System Administrator'),
            role: role as Role,
          },
          null,
        ),
      );
      return ok({ userId: created.userId, username: created.username, role });
    }

    case 'setup': {
      const result = awaitSync(initialiseWorkbook(getStore(), { seedServices, seedSettings }));
      return ok({ ...result, hasUsers: awaitSync(hasAnyUser()) });
    }

    /**
     * How long this runtime takes to hash a password. The iteration count is a
     * judgement call about Apps Script's speed, so it is worth measuring rather
     * than assuming.
     */
    case 'benchmark': {
      const hashStarted = Date.now();
      const stored = awaitSync(hashPassword('benchmark-password-value'));
      const hashMs = Date.now() - hashStarted;

      const verifyStarted = Date.now();
      const verified = awaitSync(verifyPassword('benchmark-password-value', stored));
      return ok({
        iterations: PASSWORD_ITERATIONS,
        hashMs,
        verifyMs: Date.now() - verifyStarted,
        verified,
      });
    }

    default:
      return fail('UNKNOWN_OP', 'Unsupported operation: ' + op);
  }
}

/* ---------------------------------------------------------------- entries */

export function doPost(event: { postData?: { contents?: string } }): unknown {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event?.postData?.contents ?? '{}') as Record<string, unknown>;
  } catch {
    return fail('BAD_REQUEST', 'Request body was not valid JSON.');
  }

  // Shape two: a storage or maintenance call from the command-line tools.
  if (typeof payload.op === 'string') {
    if (!masterToken() || payload.token !== masterToken()) {
      return fail('UNAUTHORIZED', 'Invalid or missing API token.');
    }
    try {
      return runStorageOp(payload.op, payload);
    } catch (error) {
      if (error instanceof GuardMismatchError) {
        return fail('GUARD_MISMATCH', error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      const code = message.split(':')[0] ?? 'SCRIPT_ERROR';
      const known = ['LOCK_TIMEOUT', 'SHEET_NOT_FOUND', 'CONFIRMATION_REQUIRED'];
      return fail(known.indexOf(code) >= 0 ? code : 'SCRIPT_ERROR', message);
    }
  }

  // Shape one: the application.
  const requestId = Utilities.getUuid().slice(0, 8);
  try {
    const result = awaitSync(
      handleRpc(
        {
          method: (payload.method as HttpMethod) ?? 'GET',
          path: String(payload.path ?? ''),
          query: (payload.query as Record<string, unknown>) ?? {},
          body: payload.body,
        },
        {
          // Apps Script does not expose the caller's address, so the sign-in
          // throttle is keyed on the username alone.
          ip: 'apps-script',
          userAgent: String(payload.userAgent ?? ''),
          token: typeof payload.token === 'string' && payload.token ? payload.token : null,
        },
      ),
    );

    return json({
      status: result.status,
      body: result.body,
      ...(result.token !== undefined ? { token: result.token } : {}),
      ...(result.tokenMaxAgeMs !== undefined ? { tokenMaxAgeMs: result.tokenMaxAgeMs } : {}),
    });
  } catch (error) {
    const mapped = toErrorResult(error, requestId);
    return json({ status: mapped.status, body: mapped.body });
  }
}

/**
 * Opening the deployment URL in a browser should say something useful. It
 * reports which build is live — the thing you cannot otherwise tell from
 * outside — and nothing else.
 */
export function doGet(): unknown {
  return json({
    ok: true,
    service: 'N & F Laundry POS',
    version: SCRIPT_VERSION,
    configured: masterToken().length > 0,
  });
}

/*
 * Apps Script looks up doPost/doGet in the global scope. The bundle is an IIFE,
 * so nothing inside it is global by default; these are published here and the
 * build appends the matching top-level declarations that call them.
 */
const globalTarget = globalThis as unknown as Record<string, unknown>;
globalTarget.__nfDoPost = doPost;
globalTarget.__nfDoGet = doGet;
