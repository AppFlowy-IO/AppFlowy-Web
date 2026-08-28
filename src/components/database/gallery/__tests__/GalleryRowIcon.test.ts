import { ViewIconType } from '@/application/types';

import { resolveGalleryRowIcon } from '../GalleryRowIcon';

describe('resolveGalleryRowIcon', () => {
  it('matches Desktop row-meta icon encodings', () => {
    const iconJson = JSON.stringify({ color: '#00BCF0', groupName: 'Interface', iconName: 'star' });

    expect(resolveGalleryRowIcon('')).toBeNull();
    expect(resolveGalleryRowIcon('🧭')).toEqual({ ty: ViewIconType.Emoji, value: '🧭' });
    expect(resolveGalleryRowIcon(iconJson)).toEqual({ ty: ViewIconType.Icon, value: iconJson });
    expect(resolveGalleryRowIcon('https://example.com/icon.png')).toEqual({
      ty: ViewIconType.URL,
      value: 'https://example.com/icon.png',
    });
    expect(resolveGalleryRowIcon('/tmp/icon.svg')).toEqual({ ty: ViewIconType.URL, value: '/tmp/icon.svg' });
  });
});
