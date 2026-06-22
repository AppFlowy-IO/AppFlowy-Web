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
  return embeddedHeight !== undefined && isDocumentBlock === true && layout === DatabaseViewLayout.Grid;
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
}: {
  contentHeight: number;
  embeddedHeight?: number;
  isDocumentBlock?: boolean;
}) {
  if (!isDocumentBlock || embeddedHeight === undefined) return undefined;

  const maxHeight = `${embeddedHeight}px`;

  if (contentHeight <= 0) {
    return { maxHeight };
  }

  return {
    height: Math.min(embeddedHeight, contentHeight),
    maxHeight,
  };
}
