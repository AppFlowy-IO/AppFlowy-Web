import bannerBlue from '@/assets/images/profile_banner/banner_blue.png';
import bannerPink from '@/assets/images/profile_banner/banner_pink.png';
import bannerPurple from '@/assets/images/profile_banner/banner_purple.png';
import bannerYellow from '@/assets/images/profile_banner/banner_yellow.png';

/**
 * Banner (a.k.a. "Banner Image" / wallpaper) shown on a member's profile card.
 *
 * The value is persisted in `cover_image_url` as an opaque string using a custom
 * URI scheme shared with the Flutter desktop app. The codec here must stay
 * byte-compatible with `frontend/appflowy_flutter/lib/features/profile_setting/data/banner.dart`,
 * otherwise banners set on desktop render as the fallback on web and vice versa:
 *
 *   image://asset-image?path=assets/images/profile_banner/banner_purple.png
 *   image://color-image?color=0xffe6e6fa
 *   https://…/api/file_storage/…/blob/…            (uploaded custom image)
 *   ''                                             (empty / unset)
 */
export type Banner =
  | { kind: 'asset'; path: string }
  | { kind: 'color'; color: string }
  | { kind: 'network'; url: string };

/** Flutter asset paths are the wire format; the web bundles its own copies of the same files. */
const ASSET_SOURCES: Record<string, string> = {
  'assets/images/profile_banner/banner_purple.png': bannerPurple,
  'assets/images/profile_banner/banner_blue.png': bannerBlue,
  'assets/images/profile_banner/banner_yellow.png': bannerYellow,
  'assets/images/profile_banner/banner_pink.png': bannerPink,
};

/** The 8 presets, in desktop order. Index 0 is the "Default" one. */
export const DEFAULT_BANNERS: Banner[] = [
  { kind: 'asset', path: 'assets/images/profile_banner/banner_purple.png' },
  { kind: 'asset', path: 'assets/images/profile_banner/banner_blue.png' },
  { kind: 'asset', path: 'assets/images/profile_banner/banner_yellow.png' },
  { kind: 'asset', path: 'assets/images/profile_banner/banner_pink.png' },
  { kind: 'color', color: '#E6E6FA' },
  { kind: 'color', color: '#E9F5D7' },
  { kind: 'color', color: '#FCF5CF' },
  { kind: 'color', color: '#FAE3E3' },
];

export const DEFAULT_BANNER = DEFAULT_BANNERS[0];

/** Resolve an asset banner to a bundled image URL. Unknown paths fall back to the default. */
export function getAssetBannerSrc(path: string): string {
  return ASSET_SOURCES[path] ?? bannerPurple;
}

/** `0xAARRGGBB` (Flutter's `Color.toHexString`) — alpha first, lowercase. */
function toFlutterHex(cssColor: string): string {
  const hex = cssColor.replace('#', '').toLowerCase();

  return `0x${hex.length === 6 ? `ff${hex}` : hex}`;
}

/**
 * Accepts `#RRGGBB`, `0xAARRGGBB`, and bare 6/8-digit hex, mirroring
 * `ColorExtension.toColor` in banner.dart. Returns a CSS `#RRGGBB(AA)` string.
 */
function fromFlutterHex(value: string): string | null {
  const hex = value.replace('#', '').replace(/^0x/i, '');

  if (!/^[0-9a-f]+$/i.test(hex)) return null;

  if (hex.length === 6) return `#${hex.toUpperCase()}`;
  // Flutter stores ARGB; CSS hex is RGBA.
  if (hex.length === 8) {
    const alpha = hex.slice(0, 2);
    const rgb = hex.slice(2);

    return `#${(alpha.toLowerCase() === 'ff' ? rgb : rgb + alpha).toUpperCase()}`;
  }

  return null;
}

/** Serialize a banner for `cover_image_url`. Built by hand so the output matches Flutter exactly (no percent-encoding). */
export function bannerToUrl(banner: Banner): string {
  switch (banner.kind) {
    case 'asset':
      return `image://asset-image?path=${banner.path}`;
    case 'color':
      return `image://color-image?color=${toFlutterHex(banner.color)}`;
    case 'network':
      return banner.url;
  }
}

/** Parse a `cover_image_url`. Anything unrecognised falls back to the default banner, as on desktop. */
export function bannerFromUrl(url: string | null | undefined): Banner {
  if (!url) return DEFAULT_BANNER;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { kind: 'network', url };
  }

  const match = /^image:\/\/(color-image|asset-image)\?(.*)$/.exec(url);

  if (!match) return DEFAULT_BANNER;

  const [, host, query] = match;
  // Read the raw value: Flutter writes asset paths unencoded, so `path=` may contain slashes.
  const value = query.slice(query.indexOf('=') + 1);

  if (host === 'asset-image') {
    return value ? { kind: 'asset', path: value } : DEFAULT_BANNER;
  }

  const color = fromFlutterHex(value);

  return color ? { kind: 'color', color } : DEFAULT_BANNER;
}

export function isSameBanner(a: Banner | null | undefined, b: Banner | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'asset' && b.kind === 'asset') return a.path === b.path;
  if (a.kind === 'color' && b.kind === 'color') return a.color.toLowerCase() === b.color.toLowerCase();
  if (a.kind === 'network' && b.kind === 'network') return a.url === b.url;
  return false;
}
