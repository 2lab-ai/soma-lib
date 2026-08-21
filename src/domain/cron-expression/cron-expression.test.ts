import { describe, expect, it } from 'vitest';

import { isValidCronExpression, isValidCronName, matchesCronExpression } from './index';

describe('matchesCronExpression', () => {
  // All tests use explicit UTC dates (Z suffix) to ensure UTC-based matching
  it('matches exact minute and hour in UTC', () => {
    const date = new Date('2026-03-28T09:30:00Z');
    expect(matchesCronExpression('30 9 * * *', date)).toBe(true);
    expect(matchesCronExpression('31 9 * * *', date)).toBe(false);
  });

  it('matches day-of-week range in UTC', () => {
    // 2026-03-28 is Saturday (dow=6) in UTC
    const sat = new Date('2026-03-28T09:00:00Z');
    expect(matchesCronExpression('0 9 * * 1-5', sat)).toBe(false); // Mon-Fri
    expect(matchesCronExpression('0 9 * * 6', sat)).toBe(true);
  });

  it('matches wildcard', () => {
    const date = new Date('2026-03-28T09:30:00Z');
    expect(matchesCronExpression('* * * * *', date)).toBe(true);
  });

  it('matches step values in UTC', () => {
    const date = new Date('2026-03-28T09:30:00Z');
    expect(matchesCronExpression('*/15 * * * *', date)).toBe(true); // 30 % 15 === 0
    expect(matchesCronExpression('*/7 * * * *', date)).toBe(false); // 30 % 7 !== 0 (0,7,14,21,28)
  });

  it('matches comma lists and ranges with steps', () => {
    const date = new Date('2026-03-28T09:30:00Z');
    expect(matchesCronExpression('0,30 9 * * *', date)).toBe(true);
    expect(matchesCronExpression('0,15 9 * * *', date)).toBe(false);
    expect(matchesCronExpression('20-40/5 9 * * *', date)).toBe(true); // 20,25,30,35,40
    expect(matchesCronExpression('20-40/7 9 * * *', date)).toBe(false); // 20,27,34
  });

  it('treats day-of-week 7 as Sunday (0 === 7)', () => {
    // 2026-03-29 is Sunday (dow=0) in UTC
    const sun = new Date('2026-03-29T09:00:00Z');
    expect(matchesCronExpression('0 9 * * 0', sun)).toBe(true);
    expect(matchesCronExpression('0 9 * * 7', sun)).toBe(true);
  });

  it('honors the 0===7 alias in ranges, steps, and lists (v0.3.1 fix)', () => {
    // 2026-03-29 is Sunday (dow=0), 2026-03-28 is Saturday (dow=6) in UTC
    const sun = new Date('2026-03-29T09:00:00Z');
    const sat = new Date('2026-03-28T09:00:00Z');
    expect(matchesCronExpression('0 9 * * 5-7', sun)).toBe(true); // Fri-Sun includes Sunday
    expect(matchesCronExpression('0 9 * * 5-7', sat)).toBe(true); // and Saturday
    expect(matchesCronExpression('0 9 * * 5-6', sun)).toBe(false); // Fri-Sat excludes Sunday
    expect(matchesCronExpression('0 9 * * 5-7/2', sun)).toBe(true); // 5,7 → Sunday via alias
    expect(matchesCronExpression('0 9 * * 5-7/2', sat)).toBe(false); // 5,7 — Saturday(6) not in step
    expect(matchesCronExpression('0 9 * * 1,7', sun)).toBe(true); // list containing 7
    expect(matchesCronExpression('0 9 * * 1-3', sun)).toBe(false); // no false positive
  });

  it('rejects invalid expression', () => {
    const date = new Date();
    expect(matchesCronExpression('invalid', date)).toBe(false);
    expect(matchesCronExpression('', date)).toBe(false);
  });

  // --- B1 tests: matchesCronExpression must use UTC, not local time ---
  // These tests explicitly verify getUTC*() vs get*() by asserting
  // against known UTC component values that differ from common local
  // timezones (e.g. KST/UTC+9, EST/UTC-5, IST/UTC+5:30).
  it('B1: matches UTC hour regardless of server timezone', () => {
    // 2026-03-29T00:30:00Z → UTC hour=0, min=30
    const date = new Date('2026-03-29T00:30:00Z');
    expect(date.getUTCHours()).toBe(0); // sanity: confirm UTC
    expect(matchesCronExpression('30 0 * * *', date)).toBe(true);
    expect(matchesCronExpression('30 9 * * *', date)).toBe(false);
  });

  it('B1: matches UTC day-of-month across timezone date boundary', () => {
    // 2026-03-28T23:00:00Z → UTC dom=28; in UTC+1 and above, local dom=29
    const date = new Date('2026-03-28T23:00:00Z');
    expect(date.getUTCDate()).toBe(28); // sanity
    expect(matchesCronExpression('0 23 28 * *', date)).toBe(true);
    expect(matchesCronExpression('0 23 29 * *', date)).toBe(false);
  });

  it('B1: matches UTC day-of-week across timezone boundary', () => {
    // 2026-03-28T23:00:00Z → UTC Saturday (dow=6); in UTC+1 and above, local Sunday
    const date = new Date('2026-03-28T23:00:00Z');
    expect(date.getUTCDay()).toBe(6); // sanity
    expect(matchesCronExpression('0 23 * * 6', date)).toBe(true);
    expect(matchesCronExpression('0 23 * * 0', date)).toBe(false);
  });

  it('B1: matches UTC minute across half-hour offset timezone', () => {
    // 2026-03-29T00:15:00Z → UTC min=15; in IST (UTC+5:30), local min=45
    const date = new Date('2026-03-29T00:15:00Z');
    expect(date.getUTCMinutes()).toBe(15); // sanity
    expect(matchesCronExpression('15 0 * * *', date)).toBe(true);
    expect(matchesCronExpression('45 0 * * *', date)).toBe(false);
  });

  it('B1: matches UTC month across year boundary', () => {
    // 2026-12-31T23:30:00Z → UTC month=12, dom=31; in UTC+1 and above, local Jan 1
    const date = new Date('2026-12-31T23:30:00Z');
    expect(date.getUTCMonth()).toBe(11); // JS 0-based → cron 1-based = 12
    expect(matchesCronExpression('30 23 31 12 *', date)).toBe(true); // UTC dec 31
    expect(matchesCronExpression('30 23 1 1 *', date)).toBe(false); // would match UTC+1 jan 1
  });
});

describe('isValidCronExpression', () => {
  it('validates 5-field expressions', () => {
    expect(isValidCronExpression('0 9 * * 1-5')).toBe(true);
    expect(isValidCronExpression('*/15 * * * *')).toBe(true);
    expect(isValidCronExpression('0 9 * * *')).toBe(true);
    expect(isValidCronExpression('bad')).toBe(false);
    expect(isValidCronExpression('0 9 * *')).toBe(false); // only 4 fields
  });

  it('rejects out-of-range values', () => {
    expect(isValidCronExpression('61 * * * *')).toBe(false); // minute > 59
    expect(isValidCronExpression('* 25 * * *')).toBe(false); // hour > 23
    expect(isValidCronExpression('* * 32 * *')).toBe(false); // dom > 31
    expect(isValidCronExpression('* * * 13 *')).toBe(false); // month > 12
    expect(isValidCronExpression('* * * * 8')).toBe(false); // dow > 7
    expect(isValidCronExpression('99 99 * * *')).toBe(false); // both out of range
  });

  it('rejects zero step and reversed ranges', () => {
    expect(isValidCronExpression('*/0 * * * *')).toBe(false); // step 0
    expect(isValidCronExpression('5-1 * * * *')).toBe(false); // reversed range
    expect(isValidCronExpression('* 10-1/2 * * *')).toBe(false); // reversed range with step
  });
});

describe('isValidCronName', () => {
  it('validates cron names', () => {
    expect(isValidCronName('daily-standup')).toBe(true);
    expect(isValidCronName('my_cron_123')).toBe(true);
    expect(isValidCronName('')).toBe(false);
    expect(isValidCronName('has spaces')).toBe(false);
    expect(isValidCronName('a'.repeat(65))).toBe(false);
  });
});
