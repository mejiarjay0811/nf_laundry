import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  daysBetweenKeys,
  endOfMonthKey,
  enumerateDateKeys,
  formatDateTime,
  formatLongDate,
  isValidDateKey,
  manilaCompactDate,
  manilaDateKey,
  manilaIso,
  previousRange,
  resolveRange,
  startOfWeekKey,
} from '../datetime.js';

describe('Manila calendar', () => {
  it('buckets a UTC instant into the correct Philippine day', () => {
    // 2026-09-02T17:30Z is already 2026-09-03 01:30 in Manila.
    expect(manilaDateKey('2026-09-02T17:30:00Z')).toBe('2026-09-03');
    // 2026-09-02T15:00Z is 2026-09-02 23:00 in Manila - still the same day.
    expect(manilaDateKey('2026-09-02T15:00:00Z')).toBe('2026-09-02');
  });

  it('stamps timestamps with the explicit +08:00 offset', () => {
    expect(manilaIso('2026-09-02T11:35:04Z')).toBe('2026-09-02T19:35:04+08:00');
  });

  it('builds the compact stamp used inside transaction IDs', () => {
    expect(manilaCompactDate('2026-09-02T11:35:04Z')).toBe('20260902');
  });

  it('formats dates the way the receipts do', () => {
    expect(formatLongDate('2026-09-02T11:35:04Z')).toBe('September 2, 2026');
    expect(formatDateTime('2026-09-02T11:35:04Z')).toBe('09/02/2026 07:35 PM');
  });
});

describe('date key maths', () => {
  it('adds and subtracts whole days', () => {
    expect(addDaysToKey('2026-09-02', 1)).toBe('2026-09-03');
    expect(addDaysToKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts days between keys', () => {
    expect(daysBetweenKeys('2026-09-01', '2026-09-08')).toBe(7);
    expect(daysBetweenKeys('2026-09-08', '2026-09-01')).toBe(-7);
  });

  it('starts weeks on Monday', () => {
    // 2026-09-02 is a Wednesday.
    expect(startOfWeekKey('2026-09-02')).toBe('2026-08-31');
    expect(startOfWeekKey('2026-08-31')).toBe('2026-08-31');
  });

  it('handles leap years at the end of February', () => {
    expect(endOfMonthKey('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonthKey('2026-02-10')).toBe('2026-02-28');
  });

  it('validates date keys', () => {
    expect(isValidDateKey('2026-09-02')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('nonsense')).toBe(false);
  });

  it('enumerates an inclusive range', () => {
    expect(enumerateDateKeys('2026-09-01', '2026-09-04')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
  });
});

describe('report ranges', () => {
  it('resolves presets against a fixed today', () => {
    const today = '2026-09-02';
    expect(resolveRange('today', undefined, today)).toMatchObject({ from: today, to: today });
    expect(resolveRange('yesterday', undefined, today)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-01',
    });
    expect(resolveRange('this_month', undefined, today)).toMatchObject({ from: '2026-09-01' });
    expect(resolveRange('this_year', undefined, today)).toMatchObject({ from: '2026-01-01' });
  });

  it('produces a previous window of equal length for growth deltas', () => {
    expect(previousRange({ from: '2026-09-01', to: '2026-09-07' })).toEqual({
      from: '2026-08-25',
      to: '2026-08-31',
    });
  });
});
