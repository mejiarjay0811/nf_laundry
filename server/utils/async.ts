import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label + ' timed out after ' + ms + 'ms')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  /** Return false to stop retrying immediately (e.g. a 4xx from the source). */
  shouldRetry?: (error: unknown) => boolean;
}

const defaultShouldRetry = (error: unknown): boolean => {
  // Never retry deterministic application errors — only transport faults.
  if (error instanceof AppError) {
    return (
      error.code === 'DATA_SOURCE_UNAVAILABLE' ||
      error.code === 'DATA_SOURCE_TIMEOUT' ||
      error.code === 'DATA_SOURCE_ERROR'
    );
  }
  return true;
};

/** Retry with full-jitter exponential backoff. */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    retries,
    baseDelayMs = 250,
    maxDelayMs = 4000,
    label = 'operation',
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = Math.round(Math.random() * ceiling);
      logger.warn('Retrying ' + label, { attempt: attempt + 1, delay });
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Collapses concurrent identical async calls into one in-flight promise.
 * Prevents a burst of dashboard widgets from each hitting the spreadsheet.
 */
export function createSingleFlight() {
  const inflight = new Map<string, Promise<unknown>>();

  return function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    let settled = false;
    const promise = fn().finally(() => {
      settled = true;
      inflight.delete(key);
    });

    /*
     * Where promises settle synchronously — the Apps Script runtime — the call
     * above has already finished and run its cleanup by now. Recording it as
     * in-flight at this point would leave a completed result in the map with
     * nothing left to remove it, so every later read would be served that one
     * stale answer.
     */
    if (!settled) inflight.set(key, promise);
    return promise;
  };
}
