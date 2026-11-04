import { createHmac } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import {
  PASSWORD_ITERATIONS,
  fromHex,
  hashPassword,
  isLegacyHash,
  pbkdf2,
  setCryptoAdapter,
  signSession,
  toHex,
  utf8Bytes,
  verifyPassword,
  verifySession,
} from '../crypto.js';
import { nodeCryptoAdapter } from '../../server/utils/cryptoAdapter.js';

/**
 * The password and session code runs unchanged in Node and in Apps Script, so
 * it is built on one primitive (HMAC-SHA256) rather than either runtime's
 * crypto library. That makes it worth checking against a known-good
 * implementation instead of only against itself.
 */
beforeAll(() => {
  setCryptoAdapter(nodeCryptoAdapter);
});

const PEPPER = 'test-pepper-value';

describe('encoding', () => {
  it('round-trips hex', () => {
    const bytes = [0, 1, 15, 16, 127, 128, 255];
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });

  it('encodes UTF-8 the same way Node does', () => {
    for (const text of ['admin', 'Señor', 'Ñoño', '密码', 'á', '🧺 laundry']) {
      expect(utf8Bytes(text)).toEqual(Array.from(Buffer.from(text, 'utf8')));
    }
  });
});

describe('pbkdf2', () => {
  it('matches a reference HMAC chain', () => {
    // PBKDF2 with one output block is U1 xor U2 ... xor Uc, where
    // U1 = HMAC(password, salt || INT(1)) and Ui = HMAC(password, Ui-1).
    const password = 'correct horse';
    const salt = [1, 2, 3, 4];
    const iterations = 5;

    const key = Buffer.from(password, 'utf8');
    let block = createHmac('sha256', key)
      .update(Buffer.from(salt.concat([0, 0, 0, 1])))
      .digest();
    const expected = Buffer.from(block);
    for (let i = 1; i < iterations; i += 1) {
      block = createHmac('sha256', key).update(block).digest();
      for (let j = 0; j < expected.length; j += 1) {
        expected[j] = (expected[j] as number) ^ (block[j] as number);
      }
    }

    expect(toHex(pbkdf2(password, salt, iterations))).toBe(expected.toString('hex'));
  });

  it('is deterministic for the same inputs', () => {
    const a = pbkdf2('pw', [9, 9], 50);
    const b = pbkdf2('pw', [9, 9], 50);
    expect(toHex(a)).toBe(toHex(b));
  });

  it('changes completely with the salt', () => {
    const a = toHex(pbkdf2('pw', [1], 50));
    const b = toHex(pbkdf2('pw', [2], 50));
    expect(a).not.toBe(b);
  });
});

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('Cashier123', PEPPER);
    expect(verifyPassword('Cashier123', stored, PEPPER)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('Cashier123', PEPPER);
    expect(verifyPassword('Cashier124', stored, PEPPER)).toBe(false);
    expect(verifyPassword('', stored, PEPPER)).toBe(false);
  });

  it('rejects the right password with the wrong pepper', () => {
    // The pepper lives in Script Properties, not in the spreadsheet, so a leak
    // of the sheet alone must not be enough to check passwords against.
    const stored = hashPassword('Cashier123', PEPPER);
    expect(verifyPassword('Cashier123', stored, 'other-pepper')).toBe(false);
  });

  it('salts every hash, so identical passwords differ on disk', () => {
    const a = hashPassword('same', PEPPER);
    const b = hashPassword('same', PEPPER);
    expect(a).not.toBe(b);
    expect(verifyPassword('same', a, PEPPER)).toBe(true);
    expect(verifyPassword('same', b, PEPPER)).toBe(true);
  });

  it('records the iteration count it used', () => {
    const stored = hashPassword('x', PEPPER);
    expect(stored.startsWith('pbkdf2$' + PASSWORD_ITERATIONS + '$')).toBe(true);
  });

  it('refuses malformed or empty stored values', () => {
    for (const bad of ['', 'nonsense', 'pbkdf2$only$three', 'pbkdf2$abc$de$ff']) {
      expect(verifyPassword('x', bad, PEPPER)).toBe(false);
    }
  });

  it('recognises the old scrypt hashes it cannot verify', () => {
    expect(isLegacyHash('scrypt$16384$8$1$abc$def')).toBe(true);
    expect(isLegacyHash(hashPassword('x', PEPPER))).toBe(false);
  });
});

describe('session tokens', () => {
  const SECRET = 'session-secret-for-tests';
  const now = 1_800_000_000;

  const claims = {
    sub: 'USR-0001',
    usr: 'admin',
    role: 'Admin',
    name: 'System Administrator',
    exp: now + 3600,
  };

  it('round-trips claims', () => {
    const token = signSession(claims, SECRET);
    const result = verifySession(token, SECRET, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims).toEqual(claims);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession(claims, SECRET);
    const result = verifySession(token, 'another-secret', now);
    expect(result).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects a tampered payload', () => {
    const token = signSession(claims, SECRET);
    const [payload, signature] = token.split('.') as [string, string];
    const tampered = payload.slice(0, -2) + 'AA' + '.' + signature;
    expect(verifySession(tampered, SECRET, now).ok).toBe(false);
  });

  it('rejects an expired token', () => {
    const token = signSession({ ...claims, exp: now - 1 }, SECRET);
    expect(verifySession(token, SECRET, now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'no-dot', 'a.b.c']) {
      expect(verifySession(bad, SECRET, now).ok).toBe(false);
    }
  });

  it('survives non-ASCII names', () => {
    const withName = { ...claims, name: 'Señora Ñoño 🧺' };
    const token = signSession(withName, SECRET);
    const result = verifySession(token, SECRET, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.name).toBe('Señora Ñoño 🧺');
  });
});
