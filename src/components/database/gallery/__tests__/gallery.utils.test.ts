import { GalleryCardSize } from '@/application/types';

import {
  getGalleryCardMinWidth,
  getGalleryColumnCount,
  getGalleryCoverHeight,
  getGalleryMinimumCardHeight,
} from '../gallery.constants';
import { isGalleryInteractiveTarget } from '../gallery.utils';

describe('Gallery card dimensions', () => {
  // Figma covers are 16:9 of the card width; these are the lower bounds at each size's minimum width.
  it.each([
    [GalleryCardSize.Small, 200, 113],
    [GalleryCardSize.Medium, 260, 146],
    [GalleryCardSize.Large, 361, 203],
  ])('uses the persisted size %s for a %spx minimum card and %spx preview', (size, minWidth, coverHeight) => {
    expect(getGalleryCardMinWidth(size)).toBe(minWidth);
    expect(getGalleryCoverHeight(size)).toBe(coverHeight);
    expect(getGalleryMinimumCardHeight(size)).toBe(coverHeight + 32);
  });

  // Content widths and card counts measured from the Figma responsive frames.
  it.each([
    [1492, GalleryCardSize.Medium, 5],
    [1492, GalleryCardSize.Large, 4],
    [1492, GalleryCardSize.Small, 6],
    [1012, GalleryCardSize.Medium, 3],
    [480, GalleryCardSize.Large, 1],
    [480, GalleryCardSize.Small, 2],
    [120, GalleryCardSize.Medium, 1],
  ])('fits %spx of %s cards into %s columns', (width, size, columns) => {
    expect(getGalleryColumnCount(width, size)).toBe(columns);
  });
});

describe('Gallery interaction boundary', () => {
  it('opens from card surfaces but leaves controls and editors interactive', () => {
    const card = document.createElement('div');
    const surface = document.createElement('span');
    const button = document.createElement('button');
    const editor = document.createElement('div');
    const customControl = document.createElement('div');

    editor.setAttribute('contenteditable', 'true');
    customControl.dataset.galleryInteractive = 'true';
    card.append(surface, button, editor, customControl);

    expect(isGalleryInteractiveTarget(surface)).toBe(false);
    expect(isGalleryInteractiveTarget(button)).toBe(true);
    expect(isGalleryInteractiveTarget(editor)).toBe(true);
    expect(isGalleryInteractiveTarget(customControl)).toBe(true);
  });
});
