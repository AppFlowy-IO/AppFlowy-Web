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

/** Embedded layouts whose viewport shrinks to their content, capped at the embedded height. */
const AUTO_SHRINK_LAYOUTS = new Set<DatabaseViewLayout>([
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
]);

/** Auto-shrinking layouts whose viewport also scrolls (the grid scrolls itself). */
const SCROLL_EMBEDDED_LAYOUTS = new Set<DatabaseViewLayout>([
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
]);

function isLayoutIn(layouts: Set<DatabaseViewLayout>, layout: DatabaseViewLayout | null | undefined) {
  return layout !== null && layout !== undefined && layouts.has(layout);
}

/**
 * Whether an embedded viewport is capped (`max-height`) instead of fixed.
 *
 * Board, Calendar, Chart, Timeline and Dashboard always get the full embedded
 * height. A Dashboard in particular renders its own scroll container around
 * the widget grid, so it must never be auto-shrunk or scrolled from outside.
 */
export function shouldAutoShrinkDatabaseViewport({
  embeddedHeight,
  isDocumentBlock,
  layout,
}: DatabaseViewportStyleInput) {
  return embeddedHeight !== undefined && isDocumentBlock === true && isLayoutIn(AUTO_SHRINK_LAYOUTS, layout);
}

export function shouldScrollEmbeddedDatabaseViewport({
  embeddedHeight,
  isDocumentBlock,
  layout,
}: DatabaseViewportStyleInput) {
  return embeddedHeight !== undefined && isDocumentBlock === true && isLayoutIn(SCROLL_EMBEDDED_LAYOUTS, layout);
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
