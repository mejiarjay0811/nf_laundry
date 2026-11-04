/**
 * Money is represented internally as an integer number of centavos.
 * Never perform arithmetic on floating point peso values — always convert
 * to centavos first, operate, then convert back for display/storage.
 */

export type Centavos = number;

const MAX_SAFE_PESOS = 1_000_000_000;

/** Convert a peso value (number or string) into integer centavos. */
export function toCentavos(value: number | string | null | undefined): Centavos {
  if (value === null || value === undefined || value === '') return 0;

  const raw = typeof value === 'number' ? value : parseLooseNumber(value);
  if (!Number.isFinite(raw)) return 0;
  if (Math.abs(raw) > MAX_SAFE_PESOS) {
    throw new RangeError('Monetary value out of supported range');
  }
  // Round half away from zero at the centavo, avoiding binary FP drift by
  // going through a fixed-precision string first.
  const fixed = Number(raw.toFixed(4));
  return Math.round(fixed * 100);
}

/** Convert integer centavos back into a peso number with 2 decimals. */
export function toPesos(cent: Centavos): number {
  return Math.round(cent) / 100;
}

/** Parse user-entered strings such as "1,250.50" or "₱175" or "" . */
export function parseLooseNumber(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  return Number(cleaned);
}

export const addC = (...values: Centavos[]): Centavos =>
  values.reduce((sum, v) => sum + Math.round(v), 0);

export const subC = (a: Centavos, b: Centavos): Centavos => Math.round(a) - Math.round(b);

/** Multiply centavos by an integer quantity. Quantity must be a whole number. */
export function multiplyC(unit: Centavos, quantity: number): Centavos {
  const q = Math.round(quantity);
  return Math.round(unit) * q;
}

export const clampMinZeroC = (value: Centavos): Centavos => (value > 0 ? Math.round(value) : 0);

/** Format centavos as a Philippine Peso string, e.g. ₱1,250.00 */
export function formatPeso(cent: Centavos, opts: { symbol?: boolean } = {}): string {
  const showSymbol = opts.symbol !== false;
  const pesos = toPesos(cent);
  const formatted = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(pesos));
  const sign = pesos < 0 ? '-' : '';
  return `${sign}${showSymbol ? '\u20B1' : ''}${formatted}`;
}

/** Compact peso for dense KPI display, e.g. ₱8.4K / ₱1.2M */
export function formatPesoCompact(cent: Centavos): string {
  const pesos = toPesos(cent);
  const abs = Math.abs(pesos);
  if (abs >= 1_000_000) return `\u20B1${(pesos / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `\u20B1${(pesos / 1_000).toFixed(1)}K`;
  return formatPeso(cent);
}

/** Percentage change between two values; null when the base is zero. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
