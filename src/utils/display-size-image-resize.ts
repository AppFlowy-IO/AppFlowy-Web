/**
 * The canvas pipeline behind decode-at-display-size: re-encodes a fetched
 * image Blob at the smallest size that still fills its box, so both the Blob
 * URL and the decoded bitmap shrink from megabytes to kilobytes. The size math
 * is in `display-size-image.ts`; this module is imported lazily by the
 * thumbnail cache so it stays out of the shared app chunk.
 */

import { DecodeBox, DisplayFit, isUnboundedBox, PixelSize, targetDecodeSize } from '@/utils/display-size-image';

/** Desktop decision D-2: JPEG quality 80 for opaque images, PNG for images with transparency. */
const JPEG_QUALITY = 0.8;

/** Enough of the file to classify it and, for PNG, to walk the chunks before the first `IDAT`. */
const HEADER_BYTES = 64 * 1024;

export type ImageResizeSkipReason = 'unbounded-box' | 'gif' | 'svg' | 'animated-webp' | 'animated-png';

function bytesStartWith(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  if (bytes.length < offset + ascii.length) return false;

  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }

  return true;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** An APNG declares an `acTL` chunk before its first `IDAT`. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!isPng(bytes)) return false;

  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);

    if (bytesStartWith(bytes, 'acTL', offset + 4)) return true;
    if (bytesStartWith(bytes, 'IDAT', offset + 4) || bytesStartWith(bytes, 'IEND', offset + 4)) return false;

    // Chunk: 4-byte length, 4-byte type, data, 4-byte CRC.
    offset += 12 + length;
  }

  return false;
}

/** An animated WebP is an extended (`VP8X`) file whose feature flags set the animation bit. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  return (
    bytesStartWith(bytes, 'RIFF') &&
    bytesStartWith(bytes, 'WEBP', 8) &&
    bytesStartWith(bytes, 'VP8X', 12) &&
    bytes.length > 20 &&
    (bytes[20] & 0x02) !== 0
  );
}

const SVG_PREFIX = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;
const UTF8_BOM = [0xef, 0xbb, 0xbf];

function looksLikeSvg(bytes: Uint8Array): boolean {
  const start = UTF8_BOM.every((byte, index) => bytes[index] === byte) ? UTF8_BOM.length : 0;
  const first = bytes[start];

  // An SVG starts with `<` or whitespace, so binary images stop here.
  if (first !== 0x3c && first !== 0x20 && first !== 0x0a && first !== 0x0d && first !== 0x09) return false;

  // The prefix is ASCII; a byte-wise decode avoids TextDecoder, which some test environments lack.
  let text = '';

  for (let i = start, end = Math.min(bytes.length, start + 2048); i < end; i++) {
    text += String.fromCharCode(bytes[i]);
  }

  return SVG_PREFIX.test(text);
}

/**
 * Why `blob` must stay as it is: GIF and SVG keep their animation and vector
 * scaling, animated WebP and PNG keep their frames. Everything else (JPEG,
 * PNG, static WebP, BMP, AVIF and the PNGs HEIC/TIFF are transcoded to) can
 * be resized.
 */
export function resizeSkipReason(blob: Blob, header: Uint8Array): ImageResizeSkipReason | null {
  if (blob.type === 'image/gif' || bytesStartWith(header, 'GIF8')) return 'gif';
  if (blob.type === 'image/svg+xml' || looksLikeSvg(header)) return 'svg';
  if (isAnimatedWebp(header)) return 'animated-webp';
  if (isAnimatedPng(header)) return 'animated-png';

  return null;
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image bytes'));
    reader.readAsArrayBuffer(blob);
  });
}

async function readHeader(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blobToArrayBuffer(blob.slice(0, HEADER_BYTES)));
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/**
 * Decodes through an `<img>` rather than `createImageBitmap(blob)`: every
 * browser applies the EXIF orientation of a phone photo to an `<img>` and
 * reports the oriented size, while older `createImageBitmap` implementations
 * leave the photo sideways.
 */
function decodeBlob(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  const image = new Image();

  image.decoding = 'async';

  return new Promise<DecodedImage>((resolve, reject) => {
    const close = () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    };

    image.onload = () => {
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close });
    };

    image.onerror = () => {
      close();
      reject(new Error('Image decode failed'));
    };

    image.src = url;
  });
}

function createCanvas(size: PixelSize): HTMLCanvasElement {
  const canvas = document.createElement('canvas');

  canvas.width = size.width;
  canvas.height = size.height;

  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');

  if (!context) throw new Error('2d canvas context unavailable');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  return context;
}

/**
 * Halves the image until one more halving would undershoot the target, then
 * draws the last step at the target size. Each halving averages 2×2 pixels,
 * which a single bilinear `drawImage` skips for large ratios and so aliases.
 */
function drawStepped(context: CanvasRenderingContext2D, image: DecodedImage, target: PixelSize): void {
  let source = image.source;
  let width = image.width;
  let height = image.height;

  while (width >= target.width * 2 && height >= target.height * 2) {
    const step: PixelSize = {
      width: Math.max(target.width, Math.floor(width / 2)),
      height: Math.max(target.height, Math.floor(height / 2)),
    };
    const canvas = createCanvas(step);

    context2d(canvas).drawImage(source, 0, 0, width, height, 0, 0, step.width, step.height);
    source = canvas;
    width = step.width;
    height = step.height;
  }

  context.drawImage(source, 0, 0, width, height, 0, 0, target.width, target.height);
}

async function resampleToCanvas(image: DecodedImage, target: PixelSize): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(target);
  const context = context2d(canvas);

  // `createImageBitmap` resizes with a proper filter where it is supported. A
  // browser that ignores the resize options returns the full-size bitmap,
  // which falls through to stepped halving.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(image.source as ImageBitmapSource, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high',
      });

      try {
        if (bitmap.width === target.width && bitmap.height === target.height) {
          context.drawImage(bitmap, 0, 0);
          return canvas;
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall through to the canvas path.
    }
  }

  drawStepped(context, image, target);

  return canvas;
}

function hasTransparentPixels(canvas: HTMLCanvasElement, size: PixelSize): boolean {
  const data = context2d(canvas).getImageData(0, 0, size.width, size.height).data;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }

  return false;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Failed to encode ${type}`));
      },
      type,
      quality
    );
  });
}

export interface ResizedImage {
  blob: Blob;
  /** False when `blob` is the original. */
  resized: boolean;
  skipped?: ImageResizeSkipReason;
  intrinsic?: PixelSize;
  target?: PixelSize;
}

/**
 * Re-encodes `blob` at the smallest size that still fills `box` under `fit`:
 * JPEG (quality 0.8) when opaque, PNG when it has transparency. The original
 * comes back unchanged when it already fits the box, when the box is
 * unbounded, and for GIF, SVG and animated images. Rejects when the browser
 * cannot decode the image; callers fall back to the original.
 */
export async function resizeImageBlob(blob: Blob, box: DecodeBox, fit: DisplayFit): Promise<ResizedImage> {
  if (isUnboundedBox(box)) return { blob, resized: false, skipped: 'unbounded-box' };

  const header = await readHeader(blob);
  const skipped = resizeSkipReason(blob, header);

  if (skipped) return { blob, resized: false, skipped };

  const image = await decodeBlob(blob);

  try {
    const intrinsic: PixelSize = { width: image.width, height: image.height };
    const target = targetDecodeSize(intrinsic, box, fit);

    if (!target) return { blob, resized: false, intrinsic };

    const canvas = await resampleToCanvas(image, target);
    const opaque = blob.type === 'image/jpeg' || isJpeg(header) || !hasTransparentPixels(canvas, target);
    const resized = opaque
      ? await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY)
      : await canvasToBlob(canvas, 'image/png');

    return { blob: resized, resized: true, intrinsic, target };
  } finally {
    image.close();
  }
}
