import { GalleryCardSize } from '@/application/types';

export const GALLERY_INITIAL_ROW_LIMIT = 50;
export const GALLERY_LOAD_MORE_INCREMENT = 30;
export const GALLERY_LOAD_MORE_THRESHOLD = 200;
export const GALLERY_MAX_COLUMNS = 10;
// Figma gallery (node 7404:109352): 16px between cards in both axes.
export const GALLERY_GRID_GAP = 16;
export const GALLERY_TILE_PADDING = 0;
export const GALLERY_DESKTOP_INLINE_PADDING = 80;

// Figma cards sit on surface/layer-02 with primary text.
export const GALLERY_CARD_THEME_CLASS_NAME =
  '[--gallery-card-surface:var(--surface-layer-02)] [--gallery-card-title:var(--text-primary)] [--gallery-card-hint:var(--text-tertiary)]';

// Keep these translucent layers aligned with Flutter's GalleryRowCard. They
// intentionally composite over the card's surface color rather than using an
// opaque semantic fill token.
export const GALLERY_COVER_PLACEHOLDER_BACKGROUND_CLASS_NAME =
  'bg-[rgba(31,35,41,0.08)] [[data-dark-mode=true]_&]:bg-[rgba(89,100,122,0.25)]';
export const GALLERY_TITLE_SURFACE_BACKGROUND_CLASS_NAME =
  'bg-transparent group-hover/gallery-card:bg-fill-content-hover';

/**
 * Figma card size ranges (node 7404:109352): Small 200-259px, Medium 260-360px,
 * Large 361-480px. Columns are added while every card keeps its minimum width,
 * and the cards stretch to share what is left of the row.
 */
export const GALLERY_CARD_MIN_WIDTH: Record<GalleryCardSize, number> = {
  [GalleryCardSize.Small]: 200,
  [GalleryCardSize.Medium]: 260,
  [GalleryCardSize.Large]: 361,
};

/** Figma covers keep a 16:9 ratio of the card width, so the rendered cover follows the column width. */
export const GALLERY_COVER_ASPECT_RATIO = 16 / 9;

/** Cover height at each size's minimum width: a lower bound used before layout. */
export const GALLERY_COVER_HEIGHT: Record<GalleryCardSize, number> = {
  [GalleryCardSize.Small]: Math.round(GALLERY_CARD_MIN_WIDTH[GalleryCardSize.Small] / GALLERY_COVER_ASPECT_RATIO),
  [GalleryCardSize.Medium]: Math.round(GALLERY_CARD_MIN_WIDTH[GalleryCardSize.Medium] / GALLERY_COVER_ASPECT_RATIO),
  [GalleryCardSize.Large]: Math.round(GALLERY_CARD_MIN_WIDTH[GalleryCardSize.Large] / GALLERY_COVER_ASPECT_RATIO),
};

export const GALLERY_TITLE_BAR_HEIGHT = 32;

export function getGalleryCardMinWidth(size: GalleryCardSize): number {
  return GALLERY_CARD_MIN_WIDTH[size] ?? GALLERY_CARD_MIN_WIDTH[GalleryCardSize.Medium];
}

/** The most columns that keep each card at or above its size's minimum width. */
export function getGalleryColumnCount(availableWidth: number, size: GalleryCardSize): number {
  const minWidth = getGalleryCardMinWidth(size);
  const fit = Math.floor((availableWidth + GALLERY_GRID_GAP) / (minWidth + GALLERY_GRID_GAP));

  return Math.max(1, Math.min(GALLERY_MAX_COLUMNS, fit));
}

export function getGalleryCoverHeight(size: GalleryCardSize): number {
  return GALLERY_COVER_HEIGHT[size] ?? GALLERY_COVER_HEIGHT[GalleryCardSize.Medium];
}

export function getGalleryMinimumCardHeight(size: GalleryCardSize): number {
  return getGalleryCoverHeight(size) + GALLERY_TITLE_BAR_HEIGHT;
}
