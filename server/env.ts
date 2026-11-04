import 'dotenv/config';
import { z } from 'zod';
import { setCryptoAdapter } from '../shared/crypto.js';
import { nodeCryptoAdapter } from './utils/cryptoAdapter.js';

/**
 * This module is the seam between the code and the runtime hosting it: on Node
 * it reads process.env, and the Apps Script build swaps it for a shim that
 * reads Script Properties. Installing the crypto adapter here means whichever
 * copy is loaded also settles which HMAC implementation the shared password and
 * session code will use.
 */
setCryptoAdapter(nodeCryptoAdapter);

const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // PORT is what a hosting platform injects in production (the server also
  // serves the built client there). In development the client's dev server
  // owns that port, so API_PORT takes precedence when it is set.
  PORT: z.coerce.number().int().positive().default(4000),
  API_PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  SESSION_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters (generate with: openssl rand -hex 32)'),
  /**
   * Mixed into every password hash. It lives outside the workbook, so a leak of
   * the spreadsheet alone leaves the hashes unattackable. Empty is allowed only
   * for local development against the file-backed driver — the Apps Script
   * runtime always supplies one of its own.
   */
  PASSWORD_PEPPER: z.string().default(''),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  SESSION_REMEMBER_DAYS: z.coerce.number().int().positive().default(14),
  /**
   * Tri-state on purpose. Unset means "secure in production, not in
   * development", which is the right default. Setting it explicitly to false
   * lets a real production build run over plain HTTP on a LAN — needed to test
   * from a phone, where a Secure cookie would simply be dropped and the login
   * would appear to silently fail.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
  COOKIE_NAME: z.string().default('nf_session'),

  SHEETS_PROVIDER: z.enum(['apps-script', 'google-api', 'local']).default('local'),
  GOOGLE_SPREADSHEET_ID: z.string().optional(),

  APPS_SCRIPT_URL: z.string().url().optional(),
  APPS_SCRIPT_TOKEN: z.string().optional(),
  APPS_SCRIPT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  LOCAL_DATA_DIR: z.string().default('.data'),

  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(30),
  SHEETS_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),

  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY: boolish,
  SERVE_CLIENT: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_ADMIN_FULLNAME: z.string().optional(),
});

export type AppEnv = z.infer<typeof schema>;

function load(): AppEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => '  - ' + i.path.join('.') + ': ' + i.message)
      .join('\n');
    console.error('\nInvalid environment configuration:\n' + issues);
    console.error('\nCopy .env.example to .env and fill in the required values.\n');
    process.exit(1);
  }

  const value = parsed.data;

  if (value.SHEETS_PROVIDER === 'apps-script') {
    if (!value.APPS_SCRIPT_URL || !value.APPS_SCRIPT_TOKEN) {
      console.error('\nSHEETS_PROVIDER=apps-script requires APPS_SCRIPT_URL and APPS_SCRIPT_TOKEN.\n');
      process.exit(1);
    }
  }
  if (value.SHEETS_PROVIDER === 'google-api') {
    const hasInline = value.GOOGLE_SERVICE_ACCOUNT_EMAIL && value.GOOGLE_PRIVATE_KEY;
    if (!value.GOOGLE_SPREADSHEET_ID || !(hasInline || value.GOOGLE_APPLICATION_CREDENTIALS)) {
      console.error(
        '\nSHEETS_PROVIDER=google-api requires GOOGLE_SPREADSHEET_ID plus either ' +
          'GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS.\n',
      );
      process.exit(1);
    }
  }

  // The local driver is development storage. Shipping it to production would
  // silently serve a file-backed copy instead of the real workbook.
  if (value.NODE_ENV === 'production' && value.SHEETS_PROVIDER === 'local') {
    console.error('');
    console.error('SHEETS_PROVIDER=local cannot be used in production - it is a');
    console.error('development file store, not Google Sheets.');
    console.error('Set SHEETS_PROVIDER=apps-script or google-api in .env.');
    console.error('');
    process.exit(1);
  }

  return value;
}

const loaded = load();

export const env = {
  ...loaded,
  PORT: loaded.API_PORT ?? loaded.PORT,
};

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Host description for the diagnostics screen. The Apps Script shim reports its own. */
export const runtimeName = 'node ' + process.version;
export function runtimeUptimeSeconds(): number {
  return Math.round(process.uptime());
}
