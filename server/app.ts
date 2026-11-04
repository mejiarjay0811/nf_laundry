import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { toErrorResult } from './api/errorBody.js';
import { handleRpc, type HttpMethod, type RpcRequest } from './api/router.js';
import { env, isProd } from './env.js';
import { logger } from './logger.js';
import { asyncRoute, errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function clientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return (forwarded.split(',')[0] ?? '').trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function createApp(): Express {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(compression());
  app.use(requestId);
  // The client posts JSON as text/plain: that is a CORS-safelisted content type,
  // and it is what lets the same request reach the Apps Script deployment
  // without a preflight, which Apps Script cannot answer.
  app.use(express.json({ limit: '256kb', type: ['application/json', 'text/plain'] }));

  if (env.CORS_ORIGIN) {
    const origins = env.CORS_ORIGIN.split(',').map((value) => value.trim());
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // API responses must never be cached by an intermediary.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /*
   * One endpoint, carrying the whole API.
   *
   * The route table lives in server/api/router.ts and is executed verbatim by
   * the Apps Script deployment too, so the two hosts cannot drift apart. The
   * client speaks this shape in both cases.
   */
  app.post(
    '/api/rpc',
    asyncRoute(async (req, res) => {
      const payload = (req.body ?? {}) as Partial<RpcRequest> & { token?: string };

      /*
       * Errors are turned into the envelope here rather than being handed to
       * Express's error handler. That handler answers with a bare error body,
       * which is the right shape for a REST endpoint but not for this one — the
       * client would find no `body` to read the message out of and fall back to
       * "something went wrong", losing what actually happened. Apps Script wraps
       * its errors the same way, so both hosts report failures identically.
       */
      try {
        const result = await handleRpc(
          {
            method: (payload.method ?? 'GET') as HttpMethod,
            path: String(payload.path ?? ''),
            query: payload.query ?? {},
            body: payload.body,
          },
          {
            ip: clientIp(req),
            userAgent: String(req.headers['user-agent'] ?? ''),
            token: typeof payload.token === 'string' && payload.token ? payload.token : null,
          },
        );
        res.status(result.status).json({
          status: result.status,
          body: result.body,
          ...(result.token !== undefined ? { token: result.token } : {}),
          ...(result.tokenMaxAgeMs !== undefined ? { tokenMaxAgeMs: result.tokenMaxAgeMs } : {}),
        });
      } catch (error) {
        const mapped = toErrorResult(error, req.requestId);
        res.status(mapped.status).json({ status: mapped.status, body: mapped.body });
      }
    }),
  );

  // Plain REST liveness probe, kept because monitoring and the Android connect
  // screen need something they can simply GET.
  app.get(
    '/api/system/health',
    asyncRoute(async (req, res) => {
      const result = await handleRpc(
        { method: 'GET', path: '/system/health' },
        { ip: clientIp(req), userAgent: '', token: null },
      );
      res.status(result.status).json(result.body);
    }),
  );

  app.use('/api', notFoundHandler);

  /*
   * Serve the built client from the API itself when it has been built.
   *
   * Not gated on NODE_ENV: one origin serving both the app and the API is also
   * how the Android build reaches it over the LAN, and that needs to work
   * without pretending to be production.
   */
  if (env.SERVE_CLIENT) {
    const clientDir = path.resolve(here, '../../client');
    if (existsSync(path.join(clientDir, 'index.html'))) {
      app.use(express.static(clientDir, { maxAge: isProd ? '1h' : 0, index: false }));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(clientDir, 'index.html'));
      });
      logger.info('Serving the built client', { dir: clientDir });
    }
  }

  app.use(errorHandler);
  return app;
}
