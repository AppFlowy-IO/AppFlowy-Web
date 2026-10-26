/**
 * Decode database thumbnails and covers at the size they are shown instead of
 * at the original file's resolution, which a 28 px grid cell or a 300 px
 * gallery card does not need.
 *
 * Mirrors desktop's `lib/shared/display_size_image.dart`: the laid-out box is
 * measured in physical pixels and rounded up to a size bucket, the decode size
 * is picked from the image's own dimensions under the CSS `object-fit`, and
 * the image is never upscaled.
 *
 * Browsers decode an `<img>` at its full resolution and keep that bitmap (a
 * 12 MP photo is ~48 MB of pixels) for as long as it is shown. Authenticated
 * AppFlowy images are additionally fetched into a Blob URL, so the whole
 * original also stays in memory. This module holds the size math; the canvas
 * pipeline that re-encodes a fetched Blob at its display size lives in
 * `display-size-image-resize.ts` and is loaded only once a thumbnail needs it.
 */

export type DisplayFit = 'cover' | 'contain';

/** A box in physical pixels; a null side is unbounded. */
export interface DecodeBox {
  width: number | null;
  height: number | null;
}

export interface PixelSize {
  width: number;
  height: number;
}

const SMALLEST_DECODE_BUCKET = 64;

/** Wider than any real photo, so a box this big decodes at full resolution along that side. */
const LARGEST_DECODE_BUCKET = 16384;

/**
 * Rounds `pixels` up to 64, 96, 128, 192, 256, 384, 512, 768, … (overshooting
 * by less than 1.5×) up to 16384, so a box that keeps changing size rarely
 * decodes its image again.
 *
 * Returns null, meaning unbounded, when the side is not finite or not laid
 * out (0 or negative): a side the layout does not size must not shrink the
 * image.
 */
export function decodeSizeBucket(pixels: number): number | null {
  if (!Number.isFinite(pixels) || pixels <= 0) return null;

  for (let bucket = SMALLEST_DECODE_BUCKET; bucket < LARGEST_DECODE_BUCKET; bucket *= 2) {
    if (pixels <= bucket) return bucket;
    if (pixels <= bucket * 1.5) return (bucket * 3) / 2;
  }

  return LARGEST_DECODE_BUCKET;
}

/** The decode box for a box laid out at `cssWidth` × `cssHeight` CSS pixels on a screen with `pixelRatio`. */
export function displayDecodeBox(cssWidth: number, cssHeight: number, pixelRatio: number): DecodeBox {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 1 ? pixelRatio : 1;

  return {
    width: decodeSizeBucket(cssWidth * ratio),
    height: decodeSizeBucket(cssHeight * ratio),
  };
}

export function isUnboundedBox(box: DecodeBox): boolean {
  return box.width === null && box.height === null;
}

/** A stable key for the box and fit a decode size depends on, e.g. `64x64-cover` or `768xauto-contain`. */
export function decodeBoxKey(box: DecodeBox, fit: DisplayFit): string {
  return `${box.width ?? 'auto'}x${box.height ?? 'auto'}-${fit}`;
}

/**
 * The smallest size that still fills (`cover`) or fits (`contain`) `box`,
 * keeping the aspect ratio. For `cover` the looser side decides, for
 * `contain` the tighter one. Returns null when the image already fits, as it
 * is never upscaled, or when the box is unbounded.
 */
export function targetDecodeSize(intrinsic: PixelSize, box: DecodeBox, fit: DisplayFit): PixelSize | null {
  if (!(intrinsic.width > 0) || !(intrinsic.height > 0)) return null;

  const widthScale = box.width === null ? null : box.width / intrinsic.width;
  const heightScale = box.height === null ? null : box.height / intrinsic.height;
  let scale: number | null;

  if (widthScale === null || heightScale === null) {
    scale = widthScale ?? heightScale;
  } else {
    scale = fit === 'contain' ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
  }

  if (scale === null || scale >= 1) return null;

  const factor = scale;
  // Rounds up, allowing for floating point error so a side that already
  // matches the box is not rounded up a pixel.
  const scaled = (side: number) => Math.max(1, Math.ceil(side * factor - 1e-9));

  return { width: scaled(intrinsic.width), height: scaled(intrinsic.height) };
}
