import { GalleryCardSize } from '@/application/types';

import { getGalleryCardWidth, getGalleryCoverHeight, getGalleryMinimumCardHeight } from '../gallery.constants';
import { isGalleryInteractiveTarget } from '../gallery.utils';

describe('Gallery Flutter desktop dimensions', () => {
  it.each([
    [GalleryCardSize.Small, 220, 120],
    [GalleryCardSize.Medium, 300, 150],
    [GalleryCardSize.Large, 400, 180],
  ])('uses the persisted size %s for a %spx card and %spx preview', (size, cardWidth, coverHeight) => {
    expect(getGalleryCardWidth(size)).toBe(cardWidth);
    expect(getGalleryCoverHeight(size)).toBe(coverHeight);
    expect(getGalleryMinimumCardHeight(size)).toBe(coverHeight + 32);
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
