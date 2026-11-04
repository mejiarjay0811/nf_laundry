import { formatPeso, formatPesoCompact, toCentavos } from '@shared/money';

/** Peso display from a peso number (the shape the API returns). */
export const peso = (value: number | null | undefined): string =>
  formatPeso(toCentavos(value ?? 0));

export const pesoCompact = (value: number | null | undefined): string =>
  formatPesoCompact(toCentavos(value ?? 0));

export const pesoPlain = (value: number | null | undefined): string =>
  formatPeso(toCentavos(value ?? 0), { symbol: false });

export const count = (value: number): string => new Intl.NumberFormat('en-PH').format(value);

export const percent = (value: number | null): string =>
  value === null ? '—' : (value >= 0 ? '+' : '') + value.toFixed(1) + '%';

/** Mask a contact number for list views: 0917 *** 4567 */
export function maskContact(contact: string): string {
  const digits = contact.replace(/\D/g, '');
  if (digits.length < 7) return contact;
  return digits.slice(0, 4) + ' ••• ' + digits.slice(-4);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? singular + 's';
}
