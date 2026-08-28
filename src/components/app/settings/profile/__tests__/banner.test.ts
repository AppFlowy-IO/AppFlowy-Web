import {
  bannerFromUrl,
  bannerToUrl,
  DEFAULT_BANNER,
  DEFAULT_BANNERS,
  isSameBanner,
} from '@/components/app/settings/profile/banner';

describe('banner codec (desktop wire compatibility)', () => {
  it('serializes asset banners exactly as Flutter does', () => {
    expect(bannerToUrl(DEFAULT_BANNERS[0])).toBe('image://asset-image?path=assets/images/profile_banner/banner_purple.png');
    expect(bannerToUrl(DEFAULT_BANNERS[3])).toBe('image://asset-image?path=assets/images/profile_banner/banner_pink.png');
  });

  it('serializes color banners as 0xAARRGGBB lowercase', () => {
    expect(bannerToUrl(DEFAULT_BANNERS[4])).toBe('image://color-image?color=0xffe6e6fa');
    expect(bannerToUrl(DEFAULT_BANNERS[7])).toBe('image://color-image?color=0xfffae3e3');
  });

  it('round-trips every preset', () => {
    for (const b of DEFAULT_BANNERS) {
      expect(isSameBanner(bannerFromUrl(bannerToUrl(b)), b)).toBe(true);
    }
  });

  it('parses values written by the desktop app', () => {
    expect(bannerFromUrl('image://asset-image?path=assets/images/profile_banner/banner_blue.png'))
      .toEqual({ kind: 'asset', path: 'assets/images/profile_banner/banner_blue.png' });
    expect(bannerFromUrl('image://color-image?color=0xffe9f5d7')).toEqual({ kind: 'color', color: '#E9F5D7' });
  });

  it('accepts the alternate hex forms Flutter tolerates', () => {
    expect(bannerFromUrl('image://color-image?color=#E6E6FA')).toEqual({ kind: 'color', color: '#E6E6FA' });
    expect(bannerFromUrl('image://color-image?color=e6e6fa')).toEqual({ kind: 'color', color: '#E6E6FA' });
  });

  it('treats http(s) urls as custom network banners', () => {
    const url = 'http://localhost:8000/api/file_storage/ws/v1/blob/dir/file';
    expect(bannerFromUrl(url)).toEqual({ kind: 'network', url });
  });

  it('falls back to the default banner for empty/garbage values', () => {
    expect(bannerFromUrl('')).toEqual(DEFAULT_BANNER);
    expect(bannerFromUrl(null)).toEqual(DEFAULT_BANNER);
    expect(bannerFromUrl('nonsense')).toEqual(DEFAULT_BANNER);
    expect(bannerFromUrl('image://color-image?color=zzz')).toEqual(DEFAULT_BANNER);
  });
});
