import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';
import type { CryptoAdapter } from '../../shared/crypto.js';

/**
 * Node's side of the crypto adapter.
 *
 * Apps Script has the matching implementation built on Utilities; both feed the
 * same PBKDF2 and token code in shared/crypto.ts, so a password hashed by the
 * CLI tools verifies inside Apps Script and vice versa.
 */
export const nodeCryptoAdapter: CryptoAdapter = {
  hmacSha256(key: number[], message: number[]): number[] {
    const mac = createHmac('sha256', Buffer.from(key));
    mac.update(Buffer.from(message));
    return Array.from(mac.digest());
  },

  randomBytes(length: number): number[] {
    return Array.from(nodeRandomBytes(length));
  },
};
