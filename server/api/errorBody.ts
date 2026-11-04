import { ZodError } from 'zod';
import type { ApiErrorBody } from '../../shared/types.js';
import { isAppError } from '../errors.js';
import { isProd } from '../env.js';
import { errorMeta, logger } from '../logger.js';

/**
 * Turns any thrown value into the response body the client expects.
 *
 * Shared by both hosts so an error looks identical whether it came from the
 * Node server or from Apps Script. Users get a plain-language message and a
 * stable code; stack traces and driver internals go to the log only.
 */
export function toErrorResult(
  error: unknown,
  requestId?: string,
): { status: number; body: ApiErrorBody } {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: details[0]?.message ?? 'Please check the highlighted fields.',
          details,
          requestId,
        },
      },
    };
  }

  if (isAppError(error)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      },
    };
  }

  logger.error('Unhandled error', { requestId, ...errorMeta(error) });
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
        requestId,
        ...(isProd ? {} : { details: (error as Error)?.message }),
      },
    },
  };
}
