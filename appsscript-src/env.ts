import { setCryptoAdapter } from '../shared/crypto.js';
import { appsScriptCryptoAdapter, authSecrets } from './crypto.js';

/**
 * Apps Script's replacement for server/env.ts.
 *
 * The build swaps this in wherever the code imports the environment, so the
 * services keep reading `env.SESSION_SECRET` and friends without knowing which
 * runtime they are on. Nothing here comes from a .env file: the secrets are
 * derived inside Apps Script and never leave it.
 */
setCryptoAdapter(appsScriptCryptoAdapter);

const secrets = authSecrets();
const startedAt = Date.now();

export const env = {
  NODE_ENV: 'production' as const,
  LOG_LEVEL: 'info' as const,

  SESSION_SECRET: secrets.sessionSecret,
  PASSWORD_PEPPER: secrets.passwordPepper,
  SESSION_TTL_MINUTES: 480,
  SESSION_REMEMBER_DAYS: 14,

  /**
   * Each request is a fresh execution with its own memory, so a cache cannot
   * survive between them. This value only governs reuse within a single
   * request — where one sale legitimately reads the same table several times.
   */
  CACHE_TTL_SECONDS: 30,
};

export const isProd = true;
export const isTest = false;

export const runtimeName = 'google-apps-script';

export function runtimeUptimeSeconds(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}
