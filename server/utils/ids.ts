import { randomBytes } from '../../shared/crypto.js';

/** Uppercase base36 random suffix — collision-resistant and readable. */
export function randomSuffix(length = 4): string {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return out;
}

const HEX = '0123456789abcdef';

/** RFC 4122 version 4 UUID, built from the runtime's random source. */
export function uuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    const value = bytes[i] as number;
    out += HEX.charAt(value >> 4) + HEX.charAt(value & 0x0f);
  }
  return out;
}

/** Zero-padded sequence, e.g. formatSequence(42, 6) -> '000042' */
export function formatSequence(value: number, width: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(width, '0');
}

/** Prefixed sequential identifier, e.g. CUST-000123 */
export function prefixedId(prefix: string, value: number, width = 6): string {
  return prefix + formatSequence(value, width);
}

/** Trim, collapse internal whitespace and strip control characters. */
export function normaliseText(value: unknown, maxLength = 500): string {
  if (value === null || value === undefined) return '';
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Normalise a Philippine contact number for storage and comparison. */
export function normaliseContact(value: unknown): string {
  const raw = normaliseText(value, 30).replace(/[^0-9+]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+63')) return '0' + raw.slice(3);
  if (raw.startsWith('63') && raw.length >= 12) return '0' + raw.slice(2);
  return raw;
}

/** Case/space-insensitive key for duplicate detection. */
export function comparisonKey(value: string): string {
  return normaliseText(value).toLowerCase().replace(/\s+/g, '');
}
