import { ERROR_CODE } from '@/application/constants';
import { SubscriptionPlan, WorkspaceUsageAndLimit } from '@/application/types';
import { getAPIErrorCode } from '@/utils/errors';

import { AudioTranscriptionError } from './transcription-media';

export function transcriptionUsage(
  usage: Pick<WorkspaceUsageAndLimit, 'ai_transcription_seconds' | 'ai_transcription_seconds_limit'>
) {
  const used = usage.ai_transcription_seconds;
  const limit = usage.ai_transcription_seconds_limit;
  const available =
    typeof used === 'number' &&
    Number.isFinite(used) &&
    used >= 0 &&
    typeof limit === 'number' &&
    Number.isFinite(limit) &&
    limit >= 0;

  return {
    available,
    usedSeconds: available ? used : 0,
    remainingSeconds: available ? Math.max(0, limit - used) : undefined,
    usedMinutes: available ? used / 60 : undefined,
    limitMinutes: available ? limit / 60 : undefined,
    exhausted: available && used >= limit,
  };
}

export function isTranscriptionLimitError(error: unknown) {
  return (
    (error instanceof AudioTranscriptionError && error.code === 'quotaExceeded') ||
    getAPIErrorCode(error) === ERROR_CODE.AI_MEETING_TRANSCRIPTION_LIMIT_EXCEEDED ||
    getAPIErrorCode(error) === ERROR_CODE.AI_RESPONSE_LIMIT_EXCEEDED
  );
}

/** Match Flutter: AI Max has a paid allowance; Pro is only promoted to hosted Free workspaces. */
export function canUpgradeTranscriptionToPro(isHosted: boolean, plan: SubscriptionPlan | null, hasAIMax = false) {
  return isHosted && plan === SubscriptionPlan.Free && !hasAIMax;
}
