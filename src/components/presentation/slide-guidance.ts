import type { GenerationOptions } from './types';

/** Hidden, unchecked optional settings must not affect generation; keep saved values for reopening. */
export function effectiveSlideOptions(options: GenerationOptions): GenerationOptions {
  return {
    ...options,
    ...(options.preconfigure === false && { audience: 'Auto', tone: 'auto', contentDensity: 'auto' }),
    ...(options.instructionsEnabled === false && { instructions: '' }),
  };
}
