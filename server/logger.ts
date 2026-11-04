import { env } from './env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const threshold = ORDER[env.LOG_LEVEL];

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable]';
  }
}

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const timestamp = new Date().toISOString();
  const serialised =
    env.NODE_ENV === 'development'
      ? timestamp + ' ' + level.toUpperCase().padEnd(5) + ' ' + message +
        (meta ? ' ' + safeJson(meta) : '')
      : safeJson({ t: timestamp, level, msg: message, ...(meta ?? {}) });

  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
};

/** Normalise an unknown throwable into loggable metadata. */
export function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errName: error.name, errMessage: error.message, stack: error.stack };
  }
  return { err: safeJson(error) };
}
