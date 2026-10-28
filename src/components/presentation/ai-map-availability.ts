import type { PresentationStatus } from './server-contract';

/**
 * Why this user cannot generate an AI mind map for the page, or `undefined` when they can.
 * The studio decides both its generate action and the explanation from this one rule.
 */
export function aiMapUnavailableReason(status: PresentationStatus, canWrite: boolean): string | undefined {
  if (!canWrite) return 'You need edit access to this page to generate an AI mind map.';
  const ai = status.aiResponses;

  if (ai.metered === false) return undefined;
  if (ai.accountingReady !== true) {
    return ai.retryable
      ? "AI usage can't be checked right now, so AI mind maps can't be generated. Try again shortly."
      : "AI mind maps can't be generated until AI usage tracking is set up on this server. Ask your administrator.";
  }

  if (ai.limit !== null && (ai.remaining ?? 0) <= 0) return 'This workspace has no AI responses left.';
  return undefined;
}
