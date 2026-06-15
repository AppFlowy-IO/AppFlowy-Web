import { UIVariant } from '@/application/types';
import { shouldUseFixedDatabaseViewport } from '@/components/database/layout';

describe('shouldUseFixedDatabaseViewport', () => {
  it('keeps app standalone databases in a fixed viewport', () => {
    expect(shouldUseFixedDatabaseViewport({ variant: UIVariant.App })).toBe(true);
    expect(shouldUseFixedDatabaseViewport({})).toBe(true);
  });

  it('lets published standalone databases flow with the page', () => {
    expect(shouldUseFixedDatabaseViewport({ variant: UIVariant.Publish })).toBe(false);
  });

  it('lets document block databases flow with the document', () => {
    expect(
      shouldUseFixedDatabaseViewport({
        isDocumentBlock: true,
        variant: UIVariant.Publish,
      })
    ).toBe(false);
  });

  it('uses a fixed viewport when an embedded height is provided', () => {
    expect(
      shouldUseFixedDatabaseViewport({
        embeddedHeight: 420,
        isDocumentBlock: true,
        variant: UIVariant.Publish,
      })
    ).toBe(true);
  });
});
