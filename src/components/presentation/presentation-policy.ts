import type { PresentationStatus } from './server-contract';

const MIB = 1024 * 1024;

/** Keep rollout fallbacks in one place; explicit server capabilities always win. */
export function presentationCapabilities(status?: PresentationStatus) {
  if (!status) return undefined;
  const isPro = status.isPro ?? status.plan === 'paid';
  const remainingExports = status.remainingExports === undefined
    ? isPro ? null : Math.max(0, 1 - status.usage.freeExports - status.usage.reservedExports)
    : status.remainingExports;

  return {
    isPro,
    customSlideCount: status.capabilities?.customSlideCount ?? isPro,
    mindmapStyles: status.capabilities?.mindmapStyles ?? isPro,
    companyStyles: status.capabilities?.companyStyles ?? isPro,
    remainingExports,
    exportAvailable: status.exportAvailable ?? (remainingExports === null || remainingExports > 0),
    maxExportSlides: status.maxExportSlides ?? (isPro ? 100 : 12),
  };
}

/** Permission failures and temporary outages must never be presented as an upgrade fix. */
export function presentationUpgradeRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const { status, details } = error as { status?: number; details?: { upgradeRequired?: boolean } };

  return status === 402 ? details?.upgradeRequired !== false : status === 413 && details?.upgradeRequired === true;
}

/** Durable job failures carry a reason rather than an HTTP denial envelope. */
export function presentationQuotaReason(reason: string): boolean {
  return ['SLIDE_GENERATION_LIMIT', 'PPT_EXPORT_LIMIT', 'CUSTOM_SLIDE_COUNT', 'AI_LIMIT', 'AI_RESPONSE_LIMIT', 'MINDMAP_STYLE', 'COMPANY_STYLE'].includes(reason);
}

export const CUSTOM_SLIDE_MESSAGE = 'Custom slide counts require Pro, including counts below 12. Choose Auto or 4, 6, 8, or 12 slides, or upgrade to Pro.';
export const MINDMAP_STYLE_MESSAGE = 'Left-facing, two-sided, top-down, and curved mind-map branches require Pro. Right-facing maps with rounded branches remain available.';
export const COMPANY_STYLE_MESSAGE = 'Saving or editing a company style requires Pro. You can still upload and use ordinary templates within your plan’s upload allowance.';

export function aiMapUpgradeMessage(status?: PresentationStatus): string | undefined {
  const ai = status?.aiResponses;

  if (ai?.unlimited !== true && ai?.metered !== false && ai?.accountingReady === true && ai.limit !== null && ai.remaining === 0)
    return 'This workspace has no AI responses left. Upgrade to Pro to generate AI mind maps; saved and page-structure maps remain available.';
}

/** Server allowance is authoritative; the plan fallback supports older Cloud versions. */
export function templateUploadLimit(status?: Pick<PresentationStatus, 'plan' | 'maxTemplateBytes'>): number | null {
  const limit = status?.maxTemplateBytes;

  if (limit === null) return null;
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? limit
    : (status?.plan === 'paid' ? 50 : 5) * MIB;
}

/** An explicit null means self-host has no upload-size cap; undefined is legacy/unknown. */
export function templateUploadHint(maxBytes: number | null): string {
  return maxBytes === null ? '.pptx or .potx' : `.pptx or .potx · up to ${maxBytes / MIB} MB`;
}

export function templateUploadSizeMessage(maxBytes: number): string {
  return maxBytes === 5 * MIB
    ? 'The Free plan allows PowerPoint templates up to 5 MB.'
    : `Choose a PowerPoint template up to ${maxBytes / MIB} MB.`;
}

interface SlideLimits {
  remainingSlides?: number | null;
  maxSlides?: number;
}

/** Explain a known server limit. Missing capability or quota fields are not admission decisions. */
export function slideCountLimitMessage(count: number, limits: SlideLimits): string | undefined {
  if (limits.remainingSlides === 0) return 'This workspace has used its generated-slide allowance. Saved presentations, preview, and presenting remain available.';
  if (limits.remainingSlides !== undefined && limits.remainingSlides !== null && count > limits.remainingSlides) {
    return `This workspace has ${limits.remainingSlides} slides remaining. Choose Auto or a smaller available count, or upgrade to Pro.`;
  }

  if (limits.maxSlides !== undefined && count > limits.maxSlides) {
    return `Choose at most ${limits.maxSlides} slides per presentation.`;
  }

}
