import type { ApiErrorBody } from '@shared/types';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

const NETWORK_MESSAGE =
  'Unable to reach the server. Please check your connection and try again.';

/**
 * Where the API lives.
 *
 * Configured at build time so the Android build can point straight at the Apps
 * Script deployment, which is the whole backend when there is no laptop on the
 * network. Left unset, the app talks to its own origin, which is what the dev
 * server does.
 */
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '/api/rpc';

/* ------------------------------------------------------------------ session */

const TOKEN_KEY = 'nf.session.token';

/**
 * The session token is held in localStorage rather than an HttpOnly cookie.
 *
 * Not a preference: the app and the API are on different origins once the
 * backend is Apps Script, and a cross-site cookie would simply be dropped.
 * The token is short-lived and carries no secret beyond the session itself.
 */
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing with storage disabled: the session lasts this page only.
  }
}

/* ------------------------------------------------------------------ request */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Query parameters; undefined/empty values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function cleanQuery(query?: RequestOptions['query']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

interface Envelope {
  status?: number;
  body?: unknown;
  token?: string | null;
  tokenMaxAgeMs?: number;
}

/**
 * The single entry point for the client.
 *
 * Every call is one POST carrying the method and path it wants, because Apps
 * Script exposes exactly one URL and only doGet/doPost. The body goes as
 * text/plain on purpose: it is a CORS-safelisted content type, so the browser
 * skips the preflight that Apps Script has no way to answer.
 *
 * Failures always arrive as an ApiError with a message fit to show a user, so
 * screens never interpret status codes or handle network exceptions.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, query } = options;

  const payload = {
    method,
    path,
    query: cleanQuery(query),
    body,
    token: getToken(),
  };

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      redirect: 'follow',
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: NETWORK_MESSAGE });
  }

  const text = await response.text();
  let envelope: Envelope | null = null;
  if (text) {
    try {
      envelope = JSON.parse(text) as Envelope;
    } catch {
      envelope = null;
    }
  }

  /*
   * Anything that is not our envelope has to fail loudly here.
   *
   * Every reply from either host carries a numeric `status`. Without that check
   * a response of some other shape would sail past the error branch below and
   * be handed back as `undefined` — which surfaces somewhere far away as a
   * blank screen or a "data cannot be undefined" crash, with nothing pointing
   * at the real cause.
   *
   * Two shapes are worth naming, because both are things a person can fix: an
   * older backend still answering with the storage-operation envelope, and a
   * deployment not published to "Anyone", which returns a sign-in page.
   */
  if (!envelope || typeof envelope.status !== 'number') {
    const looksLikeOldBackend =
      envelope !== null && typeof envelope === 'object' && 'ok' in (envelope as object);

    throw new ApiError(response.status || 0, {
      code: looksLikeOldBackend ? 'BACKEND_OUTDATED' : 'NETWORK_ERROR',
      message: looksLikeOldBackend
        ? 'The backend is running an older version than this app. Re-deploy the ' +
          'Apps Script backend (Bundle.gs) from Manage deployments, then try again.'
        : response.ok
          ? 'The server sent a response the app could not read. If this persists, ' +
            'the backend may need to be re-deployed with access set to "Anyone".'
          : NETWORK_MESSAGE,
    });
  }

  if (envelope.token !== undefined) setToken(envelope.token);

  const status = envelope.status;
  if (status >= 400) {
    // A rejected session is spent — drop it so the app returns to sign-in
    // instead of retrying with a token the server will keep refusing.
    if (status === 401) setToken(null);
    const errorBody = (envelope.body as ApiErrorBody | null)?.error;
    throw new ApiError(
      status,
      errorBody ?? { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' },
    );
  }

  return envelope.body as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Stable key for idempotent POSTs — one per form submission attempt. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
