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
