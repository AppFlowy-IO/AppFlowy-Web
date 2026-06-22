import { DatabaseViewLayout, UIVariant } from '@/application/types';
import {
  getDatabaseViewportStyle,
  getEmbeddedGridViewportStyle,
  shouldAutoShrinkDatabaseViewport,
  shouldUseFixedDatabaseViewport,
} from '@/components/database/layout';

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

  it('uses embedded height as a max cap for document grid viewports', () => {
    const input = {
      embeddedHeight: 600,
      isDocumentBlock: true,
      layout: DatabaseViewLayout.Grid,
    };

    expect(shouldAutoShrinkDatabaseViewport(input)).toBe(true);
    expect(getDatabaseViewportStyle(input)).toEqual({ maxHeight: '600px' });
    expect(getEmbeddedGridViewportStyle({ contentHeight: 180, embeddedHeight: 600, isDocumentBlock: true })).toEqual({
      height: 180,
      maxHeight: '600px',
    });
  });

  it('keeps embedded grid height capped at the default viewport when content is taller', () => {
    expect(getEmbeddedGridViewportStyle({ contentHeight: 900, embeddedHeight: 600, isDocumentBlock: true })).toEqual({
      height: 600,
      maxHeight: '600px',
    });
  });

  it('keeps the max-height constraint before embedded grid content is measured', () => {
    expect(getEmbeddedGridViewportStyle({ contentHeight: 0, embeddedHeight: 600, isDocumentBlock: true })).toEqual({
      maxHeight: '600px',
    });
  });

  it('keeps non-grid embedded viewports fixed when an embedded height is provided', () => {
    const input = {
      embeddedHeight: 600,
      isDocumentBlock: true,
      layout: DatabaseViewLayout.Board,
    };

    expect(shouldAutoShrinkDatabaseViewport(input)).toBe(false);
    expect(getDatabaseViewportStyle(input)).toEqual({ height: '600px', maxHeight: '600px' });
  });
});
