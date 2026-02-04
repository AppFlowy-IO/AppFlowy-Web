import { expect, describe, it } from '@jest/globals';

import { formatTimestamp } from '../ai-meeting.utils';

describe('formatTimestamp', () => {
  describe('valid timestamps', () => {
    it('should format seconds only (< 60)', () => {
      expect(formatTimestamp(0)).toBe('00:00');
      expect(formatTimestamp(5)).toBe('00:05');
      expect(formatTimestamp(59)).toBe('00:59');
    });

    it('should format minutes and seconds (< 3600)', () => {
      expect(formatTimestamp(60)).toBe('01:00');
      expect(formatTimestamp(125)).toBe('02:05');
      expect(formatTimestamp(3599)).toBe('59:59');
    });

    it('should format hours, minutes and seconds (>= 3600)', () => {
      expect(formatTimestamp(3600)).toBe('01:00:00');
      expect(formatTimestamp(3661)).toBe('01:01:01');
      expect(formatTimestamp(7325)).toBe('02:02:05');
      expect(formatTimestamp(36000)).toBe('10:00:00');
    });

    it('should pad numbers with leading zeros', () => {
      expect(formatTimestamp(1)).toBe('00:01');
      expect(formatTimestamp(61)).toBe('01:01');
      expect(formatTimestamp(3601)).toBe('01:00:01');
    });

    it('should handle decimal values by flooring', () => {
      expect(formatTimestamp(5.9)).toBe('00:05');
      expect(formatTimestamp(65.5)).toBe('01:05');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for undefined', () => {
      expect(formatTimestamp(undefined)).toBe('');
    });

    it('should return empty string for NaN', () => {
      expect(formatTimestamp(NaN)).toBe('');
    });

    it('should return empty string for Infinity', () => {
      expect(formatTimestamp(Infinity)).toBe('');
      expect(formatTimestamp(-Infinity)).toBe('');
    });

    it('should treat negative values as zero', () => {
      expect(formatTimestamp(-1)).toBe('00:00');
      expect(formatTimestamp(-100)).toBe('00:00');
    });
  });
});
