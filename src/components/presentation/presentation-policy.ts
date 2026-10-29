import type { PresentationStatus } from './server-contract';

const MIB = 1024 * 1024;

export const MAX_TEMPLATE_BYTES = 50 * MIB;

/** Server allowance is authoritative; the plan fallback supports older Cloud versions. */
export function templateUploadLimit(status?: Pick<PresentationStatus, 'plan' | 'maxTemplateBytes'>): number {
  const limit = status?.maxTemplateBytes;

  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.min(limit, MAX_TEMPLATE_BYTES)
    : (status?.plan === 'paid' ? 50 : 5) * MIB;
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
