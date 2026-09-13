import { describe, expect, it } from '@jest/globals';

import {
  addDays,
  createTicks,
  displayEnd,
  parseTimestamp,
  PIXELS_PER_DAY,
  rangeGeometry,
  shiftRange,
  TIMELINE_SCALES,
  timeToUnit,
  unitToTime,
} from './timeline.geometry';

describe('timeline date geometry', () => {
  it.each([new Date(2026, 2, 7), new Date(2026, 9, 31)])('keeps calendar days aligned across DST from %s', (day) => {
    const start = day.getTime();
    const end = addDays(start, 3);

    expect(timeToUnit(end, 'month') - timeToUnit(start, 'month')).toBe(3);
    expect(unitToTime(timeToUnit(end, 'month'), 'month')).toBe(end);
    expect(
      rangeGeometry({ start, end: addDays(start, 2), includeTime: false }, timeToUnit(start, 'month'), 'month').width
    ).toBe(3 * PIXELS_PER_DAY.month);
  });

  it('moves all-day ranges by calendar days and keeps inclusive ends', () => {
    const before = {
      start: new Date(2026, 2, 7).getTime(),
      end: new Date(2026, 2, 9, 23, 59).getTime(),
      includeTime: false,
    };
    const after = shiftRange(before, 'move', PIXELS_PER_DAY.month, 'month');

    expect(new Date(after.start).getDate()).toBe(8);
    expect(new Date(after.start).getHours()).toBe(0);
    expect(new Date(after.end!).getDate()).toBe(10);
    expect(new Date(after.end!).getHours()).toBe(23);
    expect(new Date(displayEnd(after)).getDate()).toBe(11);
  });

  it('does not invent an end date when moving a single-date item', () => {
    const before = { start: new Date(2026, 8, 12).getTime(), includeTime: false };

    expect(shiftRange(before, 'move', 72, 'month').end).toBeUndefined();
    expect(displayEnd(before)).toBe(addDays(before.start, 1));
  });

  it('clamps a start resize to the last calendar date and an end resize to the start', () => {
    const before = {
      start: new Date(2026, 8, 12).getTime(),
      end: new Date(2026, 8, 14, 23, 59).getTime(),
      includeTime: false,
    };

    expect(shiftRange(before, 'start', 500, 'month').start).toBe(new Date(2026, 8, 14).getTime());
    expect(shiftRange(before, 'end', -500, 'month').end).toBe(before.start);
  });

  it('uses elapsed quarter hours for timed items, including repeated DST hours', () => {
    const before = {
      start: Date.parse('2026-11-01T01:45:00-04:00'),
      end: Date.parse('2026-11-01T01:45:00-05:00'),
      includeTime: true,
    };
    const after = shiftRange(before, 'move', PIXELS_PER_DAY.hour / 96, 'hour');

    expect(after.start - before.start).toBe(900_000);
    expect(after.end! - after.start).toBe(3_600_000);
    expect(unitToTime(timeToUnit(after.start, 'hour'), 'hour')).toBe(after.start);
  });

  it.each(TIMELINE_SCALES)('bounds the ruler at scale %s and keeps adjacent ticks aligned', (scale) => {
    const ticks = createTicks(timeToUnit(new Date(2026, 8, 1).getTime(), scale), scale, 'en-US');

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThan(400);
    ticks.slice(1).forEach((tick, index) => expect(tick.left).toBeCloseTo(ticks[index].left + ticks[index].width, 5));
  });

  it('accepts the Unix epoch and rejects absent or malformed dates', () => {
    expect(parseTimestamp('0')).toBe(0);
    for (const value of ['', undefined, null, 'NaN', Infinity, {}, []]) expect(parseTimestamp(value)).toBeUndefined();
  });
});
