import type { CryptoAdapter } from '../shared/crypto.js';

declare const Utilities: {
  computeHmacSha256Signature: (value: number[], key: number[]) => number[];
  getUuid: () => string;
};
declare const PropertiesService: {
  getScriptProperties: () => {
    getProperty: (key: string) => string | null;
    setProperty: (key: string, value: string) => void;
  };
};
declare const LockService: {
  getScriptLock: () => { tryLock: (ms: number) => boolean; releaseLock: () => void };
};

/**
 * Apps Script's side of the crypto adapter.
 *
 * Java byte arrays are signed, so every value crossing the boundary is
 * converted: our own code works in unsigned 0..255 throughout.
 */
function toSigned(bytes: number[]): number[] {
  const out: number[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const value = (bytes[i] as number) & 0xff;
    out[i] = value > 127 ? value - 256 : value;
  }
  return out;
}

function toUnsigned(bytes: number[]): number[] {
  const out: number[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i] as number;
    out[i] = value < 0 ? value + 256 : value;
  }
  return out;
}

export const appsScriptCryptoAdapter: CryptoAdapter = {
  hmacSha256(key: number[], message: number[]): number[] {
    return toUnsigned(Utilities.computeHmacSha256Signature(toSigned(message), toSigned(key)));
  },

  /**
   * Apps Script exposes no random-bytes API. Utilities.getUuid is a version 4
   * UUID from Java's SecureRandom, so its bytes are cryptographically strong;
   * six of the 128 bits are fixed by the UUID format, leaving 122 bits of
   * entropy per call, which is drawn on as many times as needed.
   */
  randomBytes(length: number): number[] {
    const out: number[] = [];
    while (out.length < length) {
      const hex = Utilities.getUuid().replace(/-/g, '');
      for (let i = 0; i + 1 < hex.length && out.length < length; i += 2) {
        out.push(parseInt(hex.substring(i, i + 2), 16));
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ secrets */

const AUTH_SECRET_KEY = 'AUTH_SECRET';
const LOCK_TIMEOUT_MS = 10000;

/**
 * The root secret behind password peppering and session signing.
 *
 * Generated on first use and kept in Script Properties, so nobody has to set it
 * up by hand and it never travels anywhere. Deliberately separate from
 * API_TOKEN: rotating that token to lock out the command-line tools must not
 * invalidate every stored password at the same time.
 */
function readOrCreateAuthSecret(): string {
  const properties = PropertiesService.getScriptProperties();
  const existing = properties.getProperty(AUTH_SECRET_KEY);
  if (existing) return existing;

  // Two racing first requests must not each mint a secret; the loser would
  // silently invalidate the winner's hashes.
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(LOCK_TIMEOUT_MS);
  try {
    const second = properties.getProperty(AUTH_SECRET_KEY);
    if (second) return second;

    const generated =
      Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    properties.setProperty(AUTH_SECRET_KEY, generated);
    return generated;
  } finally {
    if (locked) lock.releaseLock();
  }
}

const HEX = '0123456789abcdef';

function derive(secret: string, label: string): string {
  const key: number[] = [];
  for (let i = 0; i < secret.length; i += 1) key.push(secret.charCodeAt(i) & 0xff);
  const message: number[] = [];
  for (let i = 0; i < label.length; i += 1) message.push(label.charCodeAt(i) & 0xff);

  const digest = appsScriptCryptoAdapter.hmacSha256(key, message);
  let out = '';
  for (const byte of digest) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0f);
  return out;
}

let cached: { sessionSecret: string; passwordPepper: string } | null = null;

/**
 * Two independent keys from the one root secret, separated by their labels so
 * neither can be used in place of the other.
 */
export function authSecrets(): { sessionSecret: string; passwordPepper: string } {
  if (!cached) {
    const root = readOrCreateAuthSecret();
    cached = {
      sessionSecret: derive(root, 'nf-laundry/session/v1'),
      passwordPepper: derive(root, 'nf-laundry/pepper/v1'),
    };
  }
  return cached;
}
