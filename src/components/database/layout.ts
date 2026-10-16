import { DatabaseViewLayout, UIVariant } from '@/application/types';

export interface DatabaseViewportLayoutInput {
  embeddedHeight?: number;
  isDocumentBlock?: boolean;
  variant?: UIVariant;
}

export function shouldUseFixedDatabaseViewport({
  embeddedHeight,
  isDocumentBlock,
  variant,
}: DatabaseViewportLayoutInput) {
  return embeddedHeight !== undefined || (!isDocumentBlock && variant !== UIVariant.Publish);
}

export interface DatabaseViewportStyleInput extends DatabaseViewportLayoutInput {
  layout?: DatabaseViewLayout | null;
}

export function shouldAutoShrinkDatabaseViewport({
  embeddedHeight,
  isDocumentBlock,
  layout,
}: DatabaseViewportStyleInput) {
  return (
    embeddedHeight !== undefined &&
    isDocumentBlock === true &&
    (layout === DatabaseViewLayout.Grid ||
      layout === DatabaseViewLayout.List ||
      layout === DatabaseViewLayout.Gallery ||
      layout === DatabaseViewLayout.Feed)
  );
}

export function shouldScrollEmbeddedDatabaseViewport({
  embeddedHeight,
  isDocumentBlock,
  layout,
}: DatabaseViewportStyleInput) {
  return (
    embeddedHeight !== undefined &&
    isDocumentBlock === true &&
    (layout === DatabaseViewLayout.List || layout === DatabaseViewLayout.Gallery || layout === DatabaseViewLayout.Feed)
  );
}

export function getDatabaseViewportStyle(input: DatabaseViewportStyleInput) {
  const { embeddedHeight } = input;

  if (embeddedHeight === undefined) return undefined;

  const maxHeight = `${embeddedHeight}px`;

  if (shouldAutoShrinkDatabaseViewport(input)) {
    return { maxHeight };
  }

  return { height: maxHeight, maxHeight };
}

export function getEmbeddedGridViewportStyle({
  contentHeight,
  embeddedHeight,
  isDocumentBlock,
  isLoading = false,
}: {
  contentHeight: number;
  embeddedHeight?: number;
  isDocumentBlock?: boolean;
  isLoading?: boolean;
}) {
  if (!isDocumentBlock || embeddedHeight === undefined) return undefined;

  const maxHeight = `${embeddedHeight}px`;

  // Placeholder rows are not the final content size. Keep the loading viewport
  // stable, then let empty and small databases shrink once their rows are known.
  if (isLoading) {
    return { height: embeddedHeight, maxHeight };
  }

  if (contentHeight <= 0) {
    return { maxHeight };
  }

  return {
    height: Math.min(embeddedHeight, contentHeight),
    maxHeight,
  };
}
