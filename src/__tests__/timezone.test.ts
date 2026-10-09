// src/__tests__/timezone.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveDateRange, toLocalIsoDay, DHAKA_OFFSET_MINUTES } from '../utils/timezone';

describe('Timezone & Date Boundary Engine', () => {
  it('should resolve "today" with start-inclusive and end-exclusive boundaries', () => {
    const range = resolveDateRange({ preset: 'today' }, DHAKA_OFFSET_MINUTES);
    assert.strictEqual(range.preset, 'today');
    assert.ok(range.start < range.endExclusive);

    // Duration must be exactly 24 hours (86,400,000 ms)
    const diffMs = range.endExclusive.getTime() - range.start.getTime();
    assert.strictEqual(diffMs, 24 * 60 * 60 * 1000);
  });

  it('should resolve "yesterday" with exact 24-hour boundary preceding today', () => {
    const today = resolveDateRange({ preset: 'today' }, DHAKA_OFFSET_MINUTES);
    const yesterday = resolveDateRange({ preset: 'yesterday' }, DHAKA_OFFSET_MINUTES);

    assert.strictEqual(yesterday.endExclusive.getTime(), today.start.getTime());
    const diffMs = yesterday.endExclusive.getTime() - yesterday.start.getTime();
    assert.strictEqual(diffMs, 24 * 60 * 60 * 1000);
  });

  it('should resolve "thisMonth" starting on the 1st of the current local month', () => {
    const range = resolveDateRange({ preset: 'thisMonth' }, DHAKA_OFFSET_MINUTES);
    assert.strictEqual(range.preset, 'thisMonth');
    assert.ok(range.start < range.endExclusive);

    const localIsoStart = toLocalIsoDay(range.start, DHAKA_OFFSET_MINUTES);
    assert.ok(localIsoStart.endsWith('-01'), `Month start should end with -01, got ${localIsoStart}`);
  });

  it('should resolve "last7" spanning exactly 7 local days', () => {
    const range = resolveDateRange({ preset: 'last7' }, DHAKA_OFFSET_MINUTES);
    const diffDays = (range.endExclusive.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000);
    assert.strictEqual(diffDays, 7);
  });

  it('should resolve "last30" spanning exactly 30 local days', () => {
    const range = resolveDateRange({ preset: 'last30' }, DHAKA_OFFSET_MINUTES);
    const diffDays = (range.endExclusive.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000);
    assert.strictEqual(diffDays, 30);
  });

  it('should resolve custom ISO date boundaries', () => {
    const range = resolveDateRange(
      { from: '2026-10-01', to: '2026-10-10' },
      DHAKA_OFFSET_MINUTES,
    );
    assert.strictEqual(range.preset, 'custom');
    assert.strictEqual(range.label, '2026-10-01 to 2026-10-10');

    // 10 full days: 2026-10-01 00:00 to 2026-10-11 00:00 local time
    const diffDays = (range.endExclusive.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000);
    assert.strictEqual(diffDays, 10);
  });

  it('should format local ISO day correctly using the specified offset', () => {
    // 2026-10-01 00:00:00 UTC with +06:00 offset should be 2026-10-01 06:00:00 local => "2026-10-01"
    const utcDate = new Date('2026-10-01T00:00:00.000Z');
    const localDay = toLocalIsoDay(utcDate, DHAKA_OFFSET_MINUTES);
    assert.strictEqual(localDay, '2026-10-01');

    // 2026-09-30 20:00:00 UTC with +06:00 offset is 2026-10-01 02:00:00 local => "2026-10-01"
    const nightBeforeUtc = new Date('2026-09-30T20:00:00.000Z');
    const shiftedDay = toLocalIsoDay(nightBeforeUtc, DHAKA_OFFSET_MINUTES);
    assert.strictEqual(shiftedDay, '2026-10-01');
  });
});
