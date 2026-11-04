import { SHEETS } from '../../shared/constants.js';
import { signSession, verifySession, type SessionClaims } from '../../shared/crypto.js';
import { manilaIso } from '../../shared/datetime.js';
import type { SessionUser } from '../../shared/types.js';
import { env } from '../env.js';
import { AppError, unauthenticated } from '../errors.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import { isLegacyHash, verifyPassword } from '../utils/password.js';
import { auditRecord, recordAudit } from './audit.service.js';
import { findUserById, findUserByUsername, toUserDto } from './user.service.js';

type TokenPayload = SessionClaims;

/* -------------------------------------------------- brute-force protection */

export interface Attempt {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

/**
 * Where failed sign-in counts are kept.
 *
 * Behind an interface because the two hosts differ fundamentally: the Node
 * server is one long-lived process, whereas each Apps Script request is a fresh
 * execution with its own memory. Left in a plain Map, the throttle would reset
 * on every attempt there — that is, it would not exist at all on the deployment
 * that is actually reachable from the internet.
 */
export interface AttemptStore {
  get(key: string): Attempt | null;
  set(key: string, value: Attempt): void;
  remove(key: string): void;
  /** Optional housekeeping; stores that expire entries themselves may skip it. */
  prune?(olderThanMs: number): void;
}

function createMemoryAttemptStore(): AttemptStore {
  const attempts = new Map<string, Attempt>();
  return {
    get: (key) => attempts.get(key) ?? null,
    set: (key, value) => {
      attempts.set(key, value);
    },
    remove: (key) => {
      attempts.delete(key);
    },
    prune: (olderThanMs) => {
      const now = Date.now();
      for (const [key, entry] of attempts) {
        if (entry.blockedUntil < now && now - entry.firstAt > olderThanMs) attempts.delete(key);
      }
    },
  };
}

let store: AttemptStore = createMemoryAttemptStore();

export function setAttemptStore(next: AttemptStore): void {
  store = next;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 10 * 60 * 1000;

function attemptKey(username: string, ip: string): string {
  return username.toLowerCase() + '|' + ip;
}

export function checkLoginAllowed(username: string, ip: string): void {
  const entry = store.get(attemptKey(username, ip));
  if (!entry) return;
  if (entry.blockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.blockedUntil - Date.now()) / 60000);
    throw new AppError(
      'RATE_LIMITED',
      'Too many failed sign-in attempts. Please try again in ' + minutes + ' minute(s).',
    );
  }
}

function registerFailure(username: string, ip: string): void {
  const key = attemptKey(username, ip);
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    store.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }

  const count = entry.count + 1;
  if (count >= MAX_ATTEMPTS) {
    store.set(key, { count: 0, firstAt: now, blockedUntil: now + BLOCK_MS });
    logger.warn('Login blocked after repeated failures', { username, ip });
    return;
  }
  store.set(key, { count, firstAt: entry.firstAt, blockedUntil: entry.blockedUntil });
}

function clearFailures(username: string, ip: string): void {
  store.remove(attemptKey(username, ip));
}

/** Periodically drop stale entries so the store cannot grow without bound. */
export function pruneLoginAttempts(): void {
  store.prune?.(WINDOW_MS);
}

/* ------------------------------------------------------------- session JWT */

export function issueToken(user: SessionUser, remember: boolean): { token: string; maxAgeMs: number } {
  const maxAgeMs = remember
    ? env.SESSION_REMEMBER_DAYS * 24 * 60 * 60 * 1000
    : env.SESSION_TTL_MINUTES * 60 * 1000;

  const payload: TokenPayload = {
    sub: user.userId,
    usr: user.username,
    role: user.role,
    name: user.fullName,
    exp: Math.floor(Date.now() / 1000) + Math.floor(maxAgeMs / 1000),
  };

  return { token: signSession(payload, env.SESSION_SECRET), maxAgeMs };
}

export function verifyToken(token: string): TokenPayload {
  const result = verifySession(token, env.SESSION_SECRET, Math.floor(Date.now() / 1000));
  if (result.ok) return result.claims;
  if (result.reason === 'expired') {
    throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  throw unauthenticated();
}

/**
 * Resolve the session against the live Users sheet on every request, so a
 * deactivated or role-changed account loses access immediately rather than at
 * token expiry. Client-supplied roles are never trusted.
 */
export async function resolveSession(token: string): Promise<SessionUser> {
  const payload = verifyToken(token);
  const user = await findUserById(payload.sub);
  if (!user) throw unauthenticated('Your account no longer exists. Please contact an administrator.');
  if (user.status !== 'Active') {
    throw new AppError('FORBIDDEN', 'This account has been deactivated.');
  }
  return {
    userId: user.userId,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
  };
}

/* ------------------------------------------------------------------ login */

export interface LoginResult {
  user: SessionUser;
  token: string;
  maxAgeMs: number;
}

export async function login(
  username: string,
  password: string,
  context: { ip: string; userAgent: string; remember: boolean },
): Promise<LoginResult> {
  checkLoginAllowed(username, context.ip);

  const record = await findUserByUsername(username);

  // An account still holding a hash from the previous scrypt scheme cannot be
  // checked by this build. Saying so beats "incorrect password", which would
  // send the user round in circles trying passwords that are in fact correct.
  if (record && isLegacyHash(record.passwordHash)) {
    throw new AppError(
      'FORBIDDEN',
      'This account was created before the latest security update and needs its ' +
        'password reset by an administrator before it can sign in.',
    );
  }

  const valid = record ? await verifyPassword(password, record.passwordHash) : false;

  if (!record || !valid) {
    registerFailure(username, context.ip);
    await recordAudit({
      actor: null,
      action: 'LOGIN_FAILED',
      module: 'Auth',
      entityId: username,
      sessionInfo: context.ip + ' ' + context.userAgent,
    });
    // Identical message for unknown user and wrong password — no enumeration.
    throw unauthenticated('Incorrect username or password.');
  }

  if (record.status !== 'Active') {
    throw new AppError('FORBIDDEN', 'This account has been deactivated. Contact an administrator.');
  }

  clearFailures(username, context.ip);

  const sessionUser: SessionUser = {
    userId: record.userId,
    username: record.username,
    fullName: record.fullName,
    role: record.role,
  };

  const { token, maxAgeMs } = issueToken(sessionUser, context.remember);

  /*
   * Stamp the last-login time and write the audit row in a single commit.
   *
   * Both belong to the same event, and committing a spreadsheet costs a round
   * trip, so doing them separately made every sign-in pay for two. Neither
   * affects whether the user is allowed in, so a failure here is logged rather
   * than turned into a failed sign-in for work that actually succeeded.
   */
  try {
    await getStore().applyWrites({
      updates: [
        {
          sheet: SHEETS.users,
          row: record.row,
          patch: { 'Last Login': manilaIso() },
        },
      ],
      appends: [
        {
          sheet: SHEETS.auditLogs,
          records: [
            auditRecord({
              actor: sessionUser,
              action: 'LOGIN',
              module: 'Auth',
              entityId: record.userId,
              sessionInfo: context.ip + ' ' + context.userAgent,
            }),
          ],
        },
      ],
    });
  } catch (error) {
    logger.error('Failed to record the sign-in', { username, ...errorMeta(error) });
  }

  return { user: sessionUser, token, maxAgeMs };
}

export async function logout(user: SessionUser | null, ip: string): Promise<void> {
  if (!user) return;
  await recordAudit({
    actor: user,
    action: 'LOGOUT',
    module: 'Auth',
    entityId: user.userId,
    sessionInfo: ip,
  });
}

export async function currentUserDto(userId: string) {
  const record = await findUserById(userId);
  return record ? toUserDto(record) : null;
}
