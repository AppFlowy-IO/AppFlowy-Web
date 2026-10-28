import { decodeBoxKey, decodeSizeBucket, displayDecodeBox, targetDecodeSize } from '../display-size-image';

describe('decodeSizeBucket', () => {
  it.each([
    [1, 64],
    [64, 64],
    [65, 96],
    [96, 96],
    [97, 128],
    [150, 192],
    [200, 256],
    [300, 384],
    [400, 512],
    [600, 768],
    [1000, 1024],
    [1200, 1536],
    [1600, 2048],
    [16384, 16384],
    [20000, 16384],
  ])('rounds %d px up to the %d bucket', (pixels, bucket) => {
    expect(decodeSizeBucket(pixels)).toBe(bucket);
  });

  it.each([0, -5, NaN, Infinity])('leaves a side of %p unbounded', (pixels) => {
    expect(decodeSizeBucket(pixels)).toBeNull();
  });
});

describe('displayDecodeBox', () => {
  it('measures the box in physical pixels', () => {
    expect(displayDecodeBox(28, 28, 2)).toEqual({ width: 64, height: 64 });
    expect(displayDecodeBox(300, 150, 2)).toEqual({ width: 768, height: 384 });
    expect(displayDecodeBox(100, 100, 1.5)).toEqual({ width: 192, height: 192 });
  });

  it('never scales below a ratio of 1', () => {
    expect(displayDecodeBox(28, 28, 0.5)).toEqual({ width: 64, height: 64 });
    expect(displayDecodeBox(28, 28, NaN)).toEqual({ width: 64, height: 64 });
  });

  it('leaves a side the layout did not size unbounded', () => {
    expect(displayDecodeBox(200, 0, 1)).toEqual({ width: 256, height: null });
  });
});

describe('decodeBoxKey', () => {
  it('names the box and fit', () => {
    expect(decodeBoxKey({ width: 64, height: 64 }, 'cover')).toBe('64x64-cover');
    expect(decodeBoxKey({ width: 768, height: null }, 'contain')).toBe('768xauto-contain');
  });
});

describe('targetDecodeSize', () => {
  const photo = { width: 4000, height: 3000 };

  it('keeps the side that fills a cover box', () => {
    expect(targetDecodeSize(photo, { width: 64, height: 64 }, 'cover')).toEqual({ width: 86, height: 64 });
    expect(targetDecodeSize(photo, { width: 768, height: 384 }, 'cover')).toEqual({ width: 768, height: 576 });
  });

  it('keeps the side that fits a contain box', () => {
    expect(targetDecodeSize(photo, { width: 64, height: 64 }, 'contain')).toEqual({ width: 64, height: 48 });
    expect(targetDecodeSize(photo, { width: 768, height: 384 }, 'contain')).toEqual({ width: 512, height: 384 });
  });

  it('follows the bounded side when the other is unbounded', () => {
    expect(targetDecodeSize(photo, { width: 256, height: null }, 'cover')).toEqual({ width: 256, height: 192 });
    expect(targetDecodeSize(photo, { width: 256, height: null }, 'contain')).toEqual({ width: 256, height: 192 });
    expect(targetDecodeSize(photo, { width: null, height: 64 }, 'cover')).toEqual({ width: 86, height: 64 });
  });

  it('never upscales', () => {
    expect(targetDecodeSize({ width: 50, height: 50 }, { width: 64, height: 64 }, 'cover')).toBeNull();
    expect(targetDecodeSize({ width: 64, height: 48 }, { width: 64, height: 64 }, 'cover')).toBeNull();
    expect(targetDecodeSize({ width: 64, height: 48 }, { width: 64, height: 64 }, 'contain')).toBeNull();
  });

  it('returns null for an unbounded box or an image without a size', () => {
    expect(targetDecodeSize(photo, { width: null, height: null }, 'cover')).toBeNull();
    expect(targetDecodeSize({ width: 0, height: 0 }, { width: 64, height: 64 }, 'cover')).toBeNull();
  });

  it('does not round a side that already matches the box up a pixel', () => {
    expect(targetDecodeSize({ width: 300, height: 200 }, { width: 100, height: null }, 'cover')).toEqual({
      width: 100,
      height: 67,
    });
  });
});
