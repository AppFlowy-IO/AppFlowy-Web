import { GalleryCardSize } from '@/application/types';

export const GALLERY_INITIAL_ROW_LIMIT = 50;
export const GALLERY_LOAD_MORE_INCREMENT = 30;
export const GALLERY_LOAD_MORE_THRESHOLD = 200;
export const GALLERY_MAX_COLUMNS = 10;
export const GALLERY_GRID_GAP = 1;
export const GALLERY_TILE_PADDING = 8;
export const GALLERY_DESKTOP_INLINE_PADDING = 80;

// Gallery cards use the desktop theme's card-local palette. These values are
// intentionally scoped to Gallery instead of changing Web's global semantic
// tokens, whose dark surface and text colors differ from Flutter's desktop
// theme.
export const GALLERY_CARD_THEME_CLASS_NAME =
  '[--gallery-card-surface:#FFFFFF] [--gallery-card-title:#333333] [--gallery-card-hint:#828282] ' +
  '[[data-dark-mode=true]_&]:[--gallery-card-surface:#1A202C] ' +
  '[[data-dark-mode=true]_&]:[--gallery-card-title:#BBC3CD] ' +
  '[[data-dark-mode=true]_&]:[--gallery-card-hint:#59647A]';

// Keep these translucent layers aligned with Flutter's GalleryRowCard. They
// intentionally composite over the card's surface color rather than using an
// opaque semantic fill token.
export const GALLERY_COVER_PLACEHOLDER_BACKGROUND_CLASS_NAME =
  'bg-[rgba(31,35,41,0.08)] [[data-dark-mode=true]_&]:bg-[rgba(89,100,122,0.25)]';
export const GALLERY_TITLE_SURFACE_BACKGROUND_CLASS_NAME =
  'bg-[rgba(31,35,41,0.06)] [[data-dark-mode=true]_&]:bg-[rgba(0,0,0,0.12)]';

export const GALLERY_CARD_WIDTH: Record<GalleryCardSize, number> = {
  [GalleryCardSize.Small]: 220,
  [GalleryCardSize.Medium]: 300,
  [GalleryCardSize.Large]: 400,
};

export const GALLERY_COVER_HEIGHT: Record<GalleryCardSize, number> = {
  [GalleryCardSize.Small]: 120,
  [GalleryCardSize.Medium]: 150,
  [GalleryCardSize.Large]: 180,
};

export const GALLERY_TITLE_BAR_HEIGHT = 32;

export function getGalleryCardWidth(size: GalleryCardSize): number {
  return GALLERY_CARD_WIDTH[size] ?? GALLERY_CARD_WIDTH[GalleryCardSize.Medium];
}

export function getGalleryCoverHeight(size: GalleryCardSize): number {
  return GALLERY_COVER_HEIGHT[size] ?? GALLERY_COVER_HEIGHT[GalleryCardSize.Medium];
}

export function getGalleryMinimumCardHeight(size: GalleryCardSize): number {
  return getGalleryCoverHeight(size) + GALLERY_TITLE_BAR_HEIGHT;
}
