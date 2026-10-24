import { isAnimatedPng, isAnimatedWebp, resizeImageBlob, resizeSkipReason } from '../display-size-image-resize';

function bytesOf(ascii: string): number[] {
  return Array.from(ascii, (char) => char.charCodeAt(0));
}

/** jsdom's Blob has no `text()`. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function pngChunk(type: string, length: number): number[] {
  return [0, 0, 0, length, ...bytesOf(type), ...new Array<number>(length).fill(0), 0, 0, 0, 0];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function webp(flags: number): Uint8Array {
  return new Uint8Array([...bytesOf('RIFF'), 0, 0, 0, 0, ...bytesOf('WEBP'), ...bytesOf('VP8X'), 10, 0, 0, 0, flags, 0, 0, 0]);
}

describe('resizeSkipReason', () => {
  it('passes GIF, SVG and animated images through', () => {
    expect(resizeSkipReason(new Blob([], { type: 'image/gif' }), new Uint8Array())).toBe('gif');
    expect(resizeSkipReason(new Blob([]), new Uint8Array(bytesOf('GIF89a')))).toBe('gif');
    expect(resizeSkipReason(new Blob([], { type: 'image/svg+xml' }), new Uint8Array())).toBe('svg');
    expect(
      resizeSkipReason(new Blob([]), new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('<?xml version="1.0"?>\n<svg xmlns="x">')]))
    ).toBe('svg');
    expect(resizeSkipReason(new Blob([]), new Uint8Array(bytesOf('  <svg>')))).toBe('svg');
    expect(resizeSkipReason(new Blob([]), webp(0x02))).toBe('animated-webp');
    expect(
      resizeSkipReason(new Blob([]), new Uint8Array([...PNG_SIGNATURE, ...pngChunk('IHDR', 13), ...pngChunk('acTL', 8)]))
    ).toBe('animated-png');
  });

  it('resizes JPEG, static PNG and static WebP', () => {
    expect(resizeSkipReason(new Blob([]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(
      resizeSkipReason(new Blob([]), new Uint8Array([...PNG_SIGNATURE, ...pngChunk('IHDR', 13), ...pngChunk('IDAT', 4)]))
    ).toBeNull();
    expect(resizeSkipReason(new Blob([]), webp(0x10))).toBeNull();
  });

  it('reads the animation flag and the acTL chunk', () => {
    expect(isAnimatedWebp(webp(0x12))).toBe(true);
    expect(isAnimatedWebp(new Uint8Array(bytesOf('RIFF')))).toBe(false);
    expect(isAnimatedPng(new Uint8Array([...PNG_SIGNATURE, ...pngChunk('IDAT', 4), ...pngChunk('acTL', 8)]))).toBe(false);
  });
});

describe('resizeImageBlob', () => {
  type FakeSize = { width: number; height: number } | 'error';

  let fakeImageSize: FakeSize = { width: 4000, height: 3000 };
  let transparent = false;
  const canvases: Array<{ canvas: HTMLCanvasElement; draws: unknown[][] }> = [];
  const originalImage = global.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const revokeObjectURL = jest.fn();

  class FakeImage {
    naturalWidth = 0;
    naturalHeight = 0;
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private currentSrc = '';

    removeAttribute(): void {
      this.currentSrc = '';
    }

    get src(): string {
      return this.currentSrc;
    }

    set src(value: string) {
      this.currentSrc = value;
      queueMicrotask(() => {
        if (fakeImageSize === 'error') {
          this.onerror?.();
          return;
        }

        this.naturalWidth = fakeImageSize.width;
        this.naturalHeight = fakeImageSize.height;
        this.onload?.();
      });
    }
  }

  beforeAll(() => {
    global.Image = FakeImage as unknown as typeof Image;
    URL.createObjectURL = jest.fn(() => 'blob:decode');
    URL.revokeObjectURL = revokeObjectURL;
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
      const canvas = this;
      let record = canvases.find((entry) => entry.canvas === canvas);

      if (!record) {
        record = { canvas, draws: [] };
        canvases.push(record);
      }

      const { draws } = record;

      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (...args: unknown[]) => draws.push(args),
        getImageData: () => {
          const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255);

          if (transparent) data[3] = 0;

          return { data };
        },
      } as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: unknown
    ) {
      callback(new Blob([`${this.width}x${this.height}|${quality ?? ''}`], { type }));
    };
  });

  afterAll(() => {
    global.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  });

  beforeEach(() => {
    fakeImageSize = { width: 4000, height: 3000 };
    transparent = false;
    canvases.length = 0;
    revokeObjectURL.mockClear();
    delete (global as { createImageBitmap?: unknown }).createImageBitmap;
  });

  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], { type: 'image/jpeg' });
  const png = () => new Blob([new Uint8Array([...PNG_SIGNATURE, ...pngChunk('IHDR', 13)])], { type: 'image/png' });

  it('decodes a 12 MP photo to 86×64 for a 64×64 cover box, halving on the way down', async () => {
    const result = await resizeImageBlob(jpeg(), { width: 64, height: 64 }, 'cover');

    expect(result.resized).toBe(true);
    expect(result.intrinsic).toEqual({ width: 4000, height: 3000 });
    expect(result.target).toEqual({ width: 86, height: 64 });
    expect(result.blob.type).toBe('image/jpeg');
    await expect(readBlobText(result.blob)).resolves.toBe('86x64|0.8');

    const sizes = canvases.map(({ canvas }) => `${canvas.width}x${canvas.height}`);

    expect(sizes[0]).toBe('86x64');
    expect(sizes).toContain('2000x1500');
    expect(sizes.length).toBeGreaterThan(2);
    // The decode <img> is released.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:decode');
  });

  it('draws the bitmap createImageBitmap resized', async () => {
    const close = jest.fn();
    const createImageBitmap = jest.fn(async (_source: unknown, options: { resizeWidth: number; resizeHeight: number }) => ({
      width: options.resizeWidth,
      height: options.resizeHeight,
      close,
    }));

    (global as { createImageBitmap?: unknown }).createImageBitmap = createImageBitmap;

    const result = await resizeImageBlob(jpeg(), { width: 768, height: 384 }, 'cover');

    expect(result.target).toEqual({ width: 768, height: 576 });
    expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), {
      resizeWidth: 768,
      resizeHeight: 576,
      resizeQuality: 'high',
    });
    expect(canvases).toHaveLength(1);
    expect(canvases[0].draws).toHaveLength(1);
    expect(close).toHaveBeenCalled();
  });

  it('falls back to stepped halving when createImageBitmap ignores the resize options', async () => {
    (global as { createImageBitmap?: unknown }).createImageBitmap = jest.fn(async () => ({
      width: 4000,
      height: 3000,
      close: jest.fn(),
    }));

    await resizeImageBlob(jpeg(), { width: 64, height: 64 }, 'cover');

    expect(canvases.length).toBeGreaterThan(2);
  });

  it('keeps transparency as PNG and encodes opaque PNGs as JPEG', async () => {
    transparent = true;
    const withAlpha = await resizeImageBlob(png(), { width: 64, height: 64 }, 'contain');

    expect(withAlpha.blob.type).toBe('image/png');
    await expect(readBlobText(withAlpha.blob)).resolves.toBe('64x48|');

    transparent = false;
    const opaque = await resizeImageBlob(png(), { width: 64, height: 64 }, 'contain');

    expect(opaque.blob.type).toBe('image/jpeg');
  });

  it('returns the original when it already fits the box', async () => {
    fakeImageSize = { width: 50, height: 50 };
    const blob = jpeg();
    const result = await resizeImageBlob(blob, { width: 64, height: 64 }, 'cover');

    expect(result).toEqual({ blob, resized: false, intrinsic: { width: 50, height: 50 } });
    expect(canvases).toHaveLength(0);
  });

  it('passes GIFs and unbounded boxes through without decoding', async () => {
    const createObjectURL = URL.createObjectURL as jest.Mock;

    createObjectURL.mockClear();
    const gif = new Blob([new Uint8Array(bytesOf('GIF89a'))], { type: 'image/gif' });

    await expect(resizeImageBlob(gif, { width: 64, height: 64 }, 'cover')).resolves.toEqual({
      blob: gif,
      resized: false,
      skipped: 'gif',
    });

    const blob = jpeg();

    await expect(resizeImageBlob(blob, { width: null, height: null }, 'cover')).resolves.toEqual({
      blob,
      resized: false,
      skipped: 'unbounded-box',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects when the browser cannot decode the image', async () => {
    fakeImageSize = 'error';

    await expect(resizeImageBlob(jpeg(), { width: 64, height: 64 }, 'cover')).rejects.toThrow('Image decode failed');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:decode');
  });
});
