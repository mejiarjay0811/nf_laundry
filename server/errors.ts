/**
 * A single error taxonomy. Every AppError carries a stable machine code plus
 * a message that is safe to show an end user.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'RATE_LIMITED'
  | 'DATA_SOURCE_UNAVAILABLE'
  | 'DATA_SOURCE_TIMEOUT'
  | 'DATA_SOURCE_ERROR'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
  DATA_SOURCE_UNAVAILABLE: 503,
  DATA_SOURCE_TIMEOUT: 504,
  DATA_SOURCE_ERROR: 502,
  NOT_CONFIGURED: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly originalCause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.originalCause = options.cause;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('VALIDATION_ERROR', message, { details });

export const unauthenticated = (message = 'Please sign in to continue.') =>
  new AppError('UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError('FORBIDDEN', message);

export const notFound = (what: string) => new AppError('NOT_FOUND', what + ' was not found.');

export const conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, { details });

export const duplicate = (message: string, details?: unknown) =>
  new AppError('DUPLICATE', message, { details });

export const dataSourceError = (message: string, cause?: unknown) =>
  new AppError('DATA_SOURCE_ERROR', message, { cause });

/** User-facing copy for data-layer failures. Never leak driver internals. */
export const DATA_SOURCE_MESSAGES = {
  unavailable: 'Unable to connect to the data server. Please check your connection and try again.',
  timeout: 'The data server took too long to respond. Please try again.',
  write: 'Unable to save your changes right now. Please try again.',
  read: 'Unable to load data right now. Please try again.',
} as const;

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
