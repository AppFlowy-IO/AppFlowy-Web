import { ViewLayout } from '@/application/types';

import { shouldUseFixedGlobalCommentInput } from '../layout';

describe('shouldUseFixedGlobalCommentInput', () => {
  it('allows the sticky comment input on document publish pages', () => {
    expect(shouldUseFixedGlobalCommentInput(ViewLayout.Document)).toBe(true);
  });

  it('disables the sticky comment input on database publish pages', () => {
    expect(shouldUseFixedGlobalCommentInput(ViewLayout.Grid)).toBe(false);
    expect(shouldUseFixedGlobalCommentInput(ViewLayout.Board)).toBe(false);
    expect(shouldUseFixedGlobalCommentInput(ViewLayout.Calendar)).toBe(false);
  });

  it('keeps the sticky comment input when the view layout is not loaded yet', () => {
    expect(shouldUseFixedGlobalCommentInput(undefined)).toBe(true);
    expect(shouldUseFixedGlobalCommentInput(null)).toBe(true);
  });
});
