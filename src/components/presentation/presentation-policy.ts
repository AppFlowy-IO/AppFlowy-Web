import type { PresentationStatus } from './server-contract';

const MIB = 1024 * 1024;

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
  if (limits.maxSlides !== undefined && count > limits.maxSlides) {
    return `Choose at most ${limits.maxSlides} slides per presentation.`;
  }

  if (limits.remainingSlides !== undefined && limits.remainingSlides !== null && count > limits.remainingSlides) {
    return `This workspace has ${limits.remainingSlides} slides remaining. Choose fewer slides or check your workspace plan.`;
  }
}
