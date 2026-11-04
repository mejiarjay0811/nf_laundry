import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '../../shared/types.js';
import { toErrorResult } from '../api/errorBody.js';
import { AppError, isAppError } from '../errors.js';
import { logger } from '../logger.js';

/**
 * The single place where an error becomes an HTTP response.
 *
 * The body itself is built by the shared mapper, so Express and Apps Script
 * report failures identically.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isAppError(error)) logAppError(error, req);
  const result = toErrorResult(error, req.requestId);
  res.status(result.status).json(result.body);
}

function logAppError(error: AppError, req: Request): void {
  const meta = {
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    code: error.code,
    cause: error.originalCause instanceof Error ? error.originalCause.message : undefined,
  };

  if (error.status >= 500) logger.error(error.message, meta);
  else if (error.status === 401 || error.status === 403) logger.warn(error.message, meta);
  else logger.debug(error.message, meta);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: 'That endpoint does not exist.',
      requestId: req.requestId,
    },
  };
  res.status(404).json(body);
}

/** Wrap an async route so rejections reach the error handler. */
export function asyncRoute<T>(
  handler: (req: Request, res: Response) => Promise<T>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
