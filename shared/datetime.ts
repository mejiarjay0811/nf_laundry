/**
 * All business dates are evaluated in Philippine time (Asia/Manila).
 * The Philippines has had no daylight saving since 1978 and sits at a fixed
 * UTC+08:00 offset, so fixed-offset arithmetic is exact and deterministic.
 */

export const MANILA_OFFSET_MINUTES = 8 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export interface ManilaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(value);
}

export function isValidDate(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'string' || typeof value === 'number') {
    return !Number.isNaN(new Date(value).getTime());
  }
  return false;
}

export function manilaParts(value: Date | string | number = new Date()): ManilaParts {
  const date = toDate(value);
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

export function manilaDateKey(value: Date | string | number = new Date()): string {
  const p = manilaParts(value);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}

export function manilaCompactDate(value: Date | string | number = new Date()): string {
  const p = manilaParts(value);
  return String(p.year) + pad(p.month) + pad(p.day);
}

export function manilaIso(value: Date | string | number = new Date()): string {
  const p = manilaParts(value);
  return (
    p.year + '-' + pad(p.month) + '-' + pad(p.day) + 'T' +
    pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + '+08:00'
  );
}

export function dateKeyToUtcStart(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utcMidnight = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(utcMidnight - MANILA_OFFSET_MINUTES * MS_PER_MINUTE);
}

export function addDaysToKey(dateKey: string, days: number): string {
  const start = dateKeyToUtcStart(dateKey);
  return manilaDateKey(new Date(start.getTime() + days * MS_PER_DAY));
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const a = dateKeyToUtcStart(fromKey).getTime();
  const b = dateKeyToUtcStart(toKey).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

export function startOfWeekKey(dateKey: string): string {
  const p = manilaParts(dateKeyToUtcStart(dateKey));
  const offset = (p.weekday + 6) % 7;
  return addDaysToKey(dateKey, -offset);
}

export function startOfMonthKey(dateKey: string): string {
  return dateKey.slice(0, 7) + '-01';
}

export function endOfMonthKey(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return (y ?? 1970) + '-' + pad(m ?? 1) + '-' + pad(lastDay);
}

export function startOfYearKey(dateKey: string): string {
  return dateKey.slice(0, 4) + '-01-01';
}

export function endOfYearKey(dateKey: string): string {
  return dateKey.slice(0, 4) + '-12-31';
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const EMPTY = '\u2014';

export function formatLongDate(value: Date | string | number): string {
  if (!isValidDate(value)) return EMPTY;
  const p = manilaParts(value);
  return MONTH_NAMES[p.month - 1] + ' ' + p.day + ', ' + p.year;
}

export function formatShortDate(value: Date | string | number): string {
  if (!isValidDate(value)) return EMPTY;
  const p = manilaParts(value);
  return pad(p.month) + '/' + pad(p.day) + '/' + p.year;
}

export function formatDateTime(value: Date | string | number): string {
  if (!isValidDate(value)) return EMPTY;
  const p = manilaParts(value);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const meridiem = p.hour < 12 ? 'AM' : 'PM';
  return pad(p.month) + '/' + pad(p.day) + '/' + p.year + ' ' + pad(hour12) + ':' + pad(p.minute) + ' ' + meridiem;
}

export function formatTime(value: Date | string | number): string {
  if (!isValidDate(value)) return EMPTY;
  const p = manilaParts(value);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const meridiem = p.hour < 12 ? 'AM' : 'PM';
  return pad(hour12) + ':' + pad(p.minute) + ' ' + meridiem;
}

export function formatChartDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return MONTH_SHORT[(m ?? 1) - 1] + ' ' + d;
}

export function relativeDays(dateKey: string, referenceKey = manilaDateKey()): string {
  const diff = daysBetweenKeys(dateKey, referenceKey);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return diff + ' days ago';
}

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'last_7_days'
  | 'last_30_days'
  | 'custom';

export interface DateRange {
  from: string;
  to: string;
  label: string;
}

export function resolveRange(
  preset: RangePreset,
  custom?: { from?: string; to?: string },
  todayKey = manilaDateKey(),
): DateRange {
  switch (preset) {
    case 'today':
      return { from: todayKey, to: todayKey, label: 'Today' };
    case 'yesterday': {
      const y = addDaysToKey(todayKey, -1);
      return { from: y, to: y, label: 'Yesterday' };
    }
    case 'this_week':
      return { from: startOfWeekKey(todayKey), to: todayKey, label: 'This Week' };
    case 'this_month':
      return { from: startOfMonthKey(todayKey), to: todayKey, label: 'This Month' };
    case 'this_year':
      return { from: startOfYearKey(todayKey), to: todayKey, label: 'This Year' };
    case 'last_7_days':
      return { from: addDaysToKey(todayKey, -6), to: todayKey, label: 'Last 7 Days' };
    case 'last_30_days':
      return { from: addDaysToKey(todayKey, -29), to: todayKey, label: 'Last 30 Days' };
    case 'custom':
    default: {
      const from = custom?.from || todayKey;
      const to = custom?.to || todayKey;
      const label =
        formatShortDate(dateKeyToUtcStart(from)) + ' \u2013 ' + formatShortDate(dateKeyToUtcStart(to));
      return { from, to, label };
    }
  }
}

export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const span = daysBetweenKeys(range.from, range.to) + 1;
  return {
    from: addDaysToKey(range.from, -span),
    to: addDaysToKey(range.to, -span),
  };
}

export function enumerateDateKeys(from: string, to: string, cap = 400): string[] {
  const keys: string[] = [];
  let cursor = from;
  let guard = 0;
  while (daysBetweenKeys(cursor, to) >= 0 && guard < cap) {
    keys.push(cursor);
    cursor = addDaysToKey(cursor, 1);
    guard += 1;
  }
  return keys;
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return manilaDateKey(dateKeyToUtcStart(value)) === value;
}
