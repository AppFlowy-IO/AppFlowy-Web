import { getTokenParsed } from '@/application/session/token';
import { resizeImageBlob } from '@/utils/display-size-image-resize';
import { fetchImageBlob } from '@/utils/image';
import {
  createMemoryMediaCacheStorage,
  MEDIA_CACHE_MAX_ORIGINAL_BYTES,
  MediaCacheStorage,
  setMediaDiskCacheStorageForTests,
} from '@/utils/media-disk-cache';

import {
  acquireDisplaySizeImage,
  clearDisplaySizeImageCache,
  displaySizeImageCacheStats,
} from '../display-size-image-cache';

jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/image', () => ({ fetchImageBlob: jest.fn() }));
jest.mock('@/utils/display-size-image-resize', () => ({ resizeImageBlob: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));

const mockGetTokenParsed = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
const mockFetchImageBlob = fetchImageBlob as jest.MockedFunction<typeof fetchImageBlob>;
const mockResizeImageBlob = resizeImageBlob as jest.MockedFunction<typeof resizeImageBlob>;

const SRC = 'https://app.flowy.io/api/file_storage/ws/v1/blob/view/photo';
const BOX = { width: 64, height: 64 };

/** jsdom allocates real Blobs; the cache only reads `size`, so a fake keeps the budget tests cheap. */
function fakeBlob(size: number, type = 'image/jpeg'): Blob {
  return { size, type } as Blob;
}

describe('display-size image cache', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();
  let nextUrl = 0;

  beforeAll(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  beforeEach(() => {
    clearDisplaySizeImageCache();
    jest.clearAllMocks();
    nextUrl = 0;
    createObjectURL.mockImplementation(() => `blob:thumb-${++nextUrl}`);
    mockFetchImageBlob.mockImplementation(async () => fakeBlob(5_000_000));
    mockResizeImageBlob.mockImplementation(async (blob) => ({
      blob: fakeBlob(20_000),
      resized: true,
      intrinsic: { width: 4000, height: 3000 },
      target: { width: 86, height: 64 },
      ...(blob.size === 0 ? { blob, resized: false } : {}),
    }));
  });

  it('shares one fetch and decode between holders of the same key', async () => {
    const first = acquireDisplaySizeImage(SRC, BOX, 'cover');
    const second = acquireDisplaySizeImage(SRC, BOX, 'cover');

    await expect(first.url).resolves.toBe('blob:thumb-1');
    await expect(second.url).resolves.toBe('blob:thumb-1');
    expect(mockFetchImageBlob).toHaveBeenCalledTimes(1);
    expect(mockResizeImageBlob).toHaveBeenCalledTimes(1);
    expect(mockResizeImageBlob).toHaveBeenCalledWith(expect.objectContaining({ size: 5_000_000 }), BOX, 'cover');
  });

  it('decodes separately for another bucket or fit', async () => {
    await acquireDisplaySizeImage(SRC, BOX, 'cover').url;
    await acquireDisplaySizeImage(SRC, { width: 768, height: 384 }, 'cover').url;
    await acquireDisplaySizeImage(SRC, BOX, 'contain').url;

    expect(mockResizeImageBlob).toHaveBeenCalledTimes(3);
    expect(displaySizeImageCacheStats().entries).toBe(3);
  });

  it('retains a released image for the next mount and revokes nothing', async () => {
    const handle = acquireDisplaySizeImage(SRC, BOX, 'cover');

    await handle.url;
    handle.release();
    handle.release();

    expect(displaySizeImageCacheStats()).toEqual({ entries: 1, retained: 1, retainedBytes: 20_000 });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    const again = acquireDisplaySizeImage(SRC, BOX, 'cover');

    await expect(again.url).resolves.toBe('blob:thumb-1');
    expect(mockFetchImageBlob).toHaveBeenCalledTimes(1);
    expect(displaySizeImageCacheStats().retained).toBe(0);
  });

  it('retains an image whose holders all left before it loaded', async () => {
    const handle = acquireDisplaySizeImage(SRC, BOX, 'cover');

    handle.release();
    await expect(handle.url).resolves.toBe('blob:thumb-1');

    expect(displaySizeImageCacheStats()).toEqual({ entries: 1, retained: 1, retainedBytes: 20_000 });
  });

  it('evicts the oldest retained images beyond the byte budget', async () => {
    mockResizeImageBlob.mockImplementation(async () => ({ blob: fakeBlob(20 * 1024 * 1024), resized: true }));

    const a = acquireDisplaySizeImage(`${SRC}-a`, BOX, 'cover');
    const b = acquireDisplaySizeImage(`${SRC}-b`, BOX, 'cover');
    const c = acquireDisplaySizeImage(`${SRC}-c`, BOX, 'cover');

    await Promise.all([a.url, b.url, c.url]);
    a.release();
    b.release();

    // 40 MB retained exceeds the 32 MB budget: the oldest goes.
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1');
    expect(displaySizeImageCacheStats()).toEqual({ entries: 2, retained: 1, retainedBytes: 20 * 1024 * 1024 });

    // A held image is never evicted.
    c.release();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:thumb-2');
  });

  it('forgets a failed load so the next mount retries', async () => {
    mockFetchImageBlob.mockResolvedValueOnce(null);

    const failed = acquireDisplaySizeImage(SRC, BOX, 'cover');

    await expect(failed.url).resolves.toBeNull();
    expect(displaySizeImageCacheStats().entries).toBe(0);
    failed.release();

    const retry = acquireDisplaySizeImage(SRC, BOX, 'cover');

    await expect(retry.url).resolves.toBe('blob:thumb-1');
    expect(mockFetchImageBlob).toHaveBeenCalledTimes(2);
  });

  it('shows the original when the image cannot be resized', async () => {
    mockResizeImageBlob.mockRejectedValueOnce(new Error('decode failed'));

    const handle = acquireDisplaySizeImage(SRC, BOX, 'cover');

    await expect(handle.url).resolves.toBe('blob:thumb-1');
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ size: 5_000_000 }));
  });

  it('clears every entry and revokes its URL', async () => {
    await acquireDisplaySizeImage(SRC, BOX, 'cover').url;
    await acquireDisplaySizeImage(`${SRC}-b`, BOX, 'cover').url;

    clearDisplaySizeImageCache();

    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(displaySizeImageCacheStats()).toEqual({ entries: 0, retained: 0, retainedBytes: 0 });
  });

  describe('with the disk cache', () => {
    let disk: MediaCacheStorage;
    const flushWrites = () => new Promise((resolve) => setTimeout(resolve, 0));
    const original = `v1|user-1|${SRC}`;

    beforeEach(() => {
      disk = createMemoryMediaCacheStorage();
      setMediaDiskCacheStorageForTests(disk);
      mockGetTokenParsed.mockReturnValue({ user: { id: 'user-1' } } as never);
    });

    afterEach(() => {
      setMediaDiskCacheStorageForTests(undefined);
    });

    it('persists the original and the thumbnail, then serves the thumbnail without a fetch or a decode', async () => {
      await acquireDisplaySizeImage(SRC, BOX, 'cover').url;
      await flushWrites();

      expect((await disk.all()).map((record) => [record.key, record.bytes])).toEqual([
        [original, 5_000_000],
        [`${original}|64x64-cover`, 20_000],
      ]);

      clearDisplaySizeImageCache();
      jest.clearAllMocks();

      await expect(acquireDisplaySizeImage(SRC, BOX, 'cover').url).resolves.toBe('blob:thumb-2');
      expect(mockFetchImageBlob).not.toHaveBeenCalled();
      expect(mockResizeImageBlob).not.toHaveBeenCalled();
      expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ size: 20_000 }));
    });

    it('resizes from the cached original when only another bucket is on disk', async () => {
      await acquireDisplaySizeImage(SRC, BOX, 'cover').url;
      await flushWrites();
      clearDisplaySizeImageCache();
      jest.clearAllMocks();

      await acquireDisplaySizeImage(SRC, { width: 768, height: 384 }, 'cover').url;

      expect(mockFetchImageBlob).not.toHaveBeenCalled();
      expect(mockResizeImageBlob).toHaveBeenCalledWith(
        expect.objectContaining({ size: 5_000_000 }),
        { width: 768, height: 384 },
        'cover'
      );
    });

    it('keeps only the thumbnail of an original too large to persist', async () => {
      mockFetchImageBlob.mockResolvedValueOnce(fakeBlob(MEDIA_CACHE_MAX_ORIGINAL_BYTES + 1));

      await acquireDisplaySizeImage(SRC, BOX, 'cover').url;
      await flushWrites();

      expect((await disk.all()).map((record) => record.key)).toEqual([`${original}|64x64-cover`]);
    });

    it('persists nothing for an anonymous viewer', async () => {
      mockGetTokenParsed.mockReturnValue(null as never);

      await acquireDisplaySizeImage(SRC, BOX, 'cover').url;
      await flushWrites();

      expect(await disk.all()).toEqual([]);
      expect(mockFetchImageBlob).toHaveBeenCalledTimes(1);
    });
  });
});
