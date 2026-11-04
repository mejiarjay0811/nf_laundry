import {
  hashPassword as hashWithPepper,
  isLegacyHash,
  randomBytes,
  verifyPassword as verifyWithPepper,
} from '../../shared/crypto.js';
import { env } from '../env.js';

/**
 * Password hashing.
 *
 * The scheme is PBKDF2-HMAC-SHA256 rather than scrypt because the same code has
 * to run inside Google Apps Script, which offers no scrypt and no WebCrypto —
 * only HMAC-SHA256. See shared/crypto.ts for the iteration-count trade-off and
 * the pepper that compensates for it.
 *
 * The signatures stay async so callers are unaffected; the work itself is
 * synchronous in both runtimes.
 */

export async function hashPassword(plain: string): Promise<string> {
  return hashWithPepper(plain, env.PASSWORD_PEPPER);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return verifyWithPepper(plain, stored, env.PASSWORD_PEPPER);
}

/**
 * True for a hash written by the previous scrypt scheme, which this build
 * cannot verify. Callers surface a "reset your password" path rather than a
 * bare "incorrect password", which would be misleading.
 */
export { isLegacyHash };

export interface PasswordStrength {
  ok: boolean;
  problems: string[];
}

export function checkPasswordStrength(plain: string): PasswordStrength {
  const problems: string[] = [];
  if (plain.length < 8) problems.push('Use at least 8 characters.');
  if (!/[a-zA-Z]/.test(plain)) problems.push('Include at least one letter.');
  if (!/[0-9]/.test(plain)) problems.push('Include at least one number.');
  if (/^\s|\s$/.test(plain)) problems.push('Remove leading or trailing spaces.');
  return { ok: problems.length === 0, problems };
}

export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out + '1a';
}
