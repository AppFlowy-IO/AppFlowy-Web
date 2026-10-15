import { AudioTranscriptionError } from '../transcription-media';
import { canUpgradeTranscriptionToPro, isTranscriptionLimitError, transcriptionUsage } from '../transcription-usage';
import { SubscriptionPlan } from '@/application/types';

describe('Flutter transcription usage limits', () => {
  it('uses the workspace’s authoritative seconds, including fractional minutes, without rounding quota boundaries', () => {
    expect(transcriptionUsage({ ai_transcription_seconds: 61, ai_transcription_seconds_limit: 120 })).toEqual({
      available: true, usedSeconds: 61, remainingSeconds: 59, usedMinutes: 61 / 60, limitMinutes: 2, exhausted: false,
    });
    expect(transcriptionUsage({ ai_transcription_seconds: 119, ai_transcription_seconds_limit: 120 }).exhausted).toBe(false);
    expect(transcriptionUsage({ ai_transcription_seconds: 120, ai_transcription_seconds_limit: 120 }).exhausted).toBe(true);
    expect(transcriptionUsage({ ai_transcription_seconds: 121, ai_transcription_seconds_limit: 120 }).remainingSeconds).toBe(0);
  });

  it('blocks a zero allowance', () => {
    expect(transcriptionUsage({ ai_transcription_seconds: 0, ai_transcription_seconds_limit: 0 }).exhausted).toBe(true);
  });

  it.each([undefined, NaN, Infinity, -1])('does not invent allowances for missing/invalid server fields (%s)', (value) => {
    expect(transcriptionUsage({ ai_transcription_seconds: value, ai_transcription_seconds_limit: 120 }).available).toBe(false);
    expect(transcriptionUsage({ ai_transcription_seconds: 120, ai_transcription_seconds_limit: value }).exhausted).toBe(false);
  });

  it.each([
    ['Free', true, SubscriptionPlan.Free, false, true],
    ['Free + AI On-device', true, SubscriptionPlan.Free, false, true],
    ['Free + AI Max', true, SubscriptionPlan.Free, true, false],
    ['Pro', true, SubscriptionPlan.Pro, false, false],
    ['Team', true, SubscriptionPlan.Team, false, false],
    ['unknown subscription', true, null, false, false],
    ['self-hosted Free', false, SubscriptionPlan.Free, false, false],
    ['unknown hosting', false, null, false, false],
  ] as const)('%s shows the same upgrade action as Flutter', (_name, hosted, plan, max, expected) => {
    expect(canUpgradeTranscriptionToPro(hosted, plan, max)).toBe(expected);
  });

  it('recognizes meeting and AI-response quotas, keeping image errors distinct', () => {
    expect(isTranscriptionLimitError({ code: 1129 })).toBe(true);
    expect(isTranscriptionLimitError({ code: 1033 })).toBe(true);
    expect(isTranscriptionLimitError(new AudioTranscriptionError('quotaExceeded'))).toBe(true);
    expect(isTranscriptionLimitError({ code: 1058 })).toBe(false);
    expect(isTranscriptionLimitError(new Error('Network error'))).toBe(false);
  });
});
