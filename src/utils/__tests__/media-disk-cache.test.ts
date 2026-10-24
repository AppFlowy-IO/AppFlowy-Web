import { getTokenParsed } from '@/application/session/token';

import {
  createMemoryMediaCacheStorage,
  MEDIA_CACHE_BUDGET_BYTES,
  MEDIA_CACHE_MAX_AGE_MS,
  MEDIA_CACHE_MAX_ENTRIES,
  MEDIA_CACHE_MAX_ORIGINAL_BYTES,
  MediaCacheStorage,
  mediaCacheKeys,
  readCachedMedia,
  removeCachedOriginal,
  setMediaDiskCacheStorageForTests,
  trimMediaCache,
  writeCachedMedia,
} from '../media-disk-cache';

jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));

const mockGetTokenParsed = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
const SRC = 'https://app.flowy.io/api/file_storage/ws/v1/blob/view/photo';
const BOX = { width: 64, height: 64 };
const NOW = 1_700_000_000_000;

function fakeBlob(size: number, type = 'image/jpeg'): Blob {
  return { size, type } as Blob;
}

describe('media disk cache', () => {
  let memory: MediaCacheStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    memory = createMemoryMediaCacheStorage();
    setMediaDiskCacheStorageForTests(memory);
    mockGetTokenParsed.mockReturnValue({ user: { id: 'user-1' } } as never);
  });

  afterEach(() => {
    setMediaDiskCacheStorageForTests(undefined);
    jest.restoreAllMocks();
  });

  it('keys entries by identity, source, bucket and fit', () => {
    expect(mediaCacheKeys(SRC, BOX, 'cover')).toEqual({
      original: `v1|user-1|${SRC}`,
      derivative: `v1|user-1|${SRC}|64x64-cover`,
    });
  });

  it('has no keys for an anonymous viewer or without storage', () => {
    mockGetTokenParsed.mockReturnValue(null as never);
    expect(mediaCacheKeys(SRC, BOX, 'cover')).toBeNull();

    mockGetTokenParsed.mockReturnValue({ user: { id: 'user-1' } } as never);
    setMediaDiskCacheStorageForTests(null);
    expect(mediaCacheKeys(SRC, BOX, 'cover')).toBeNull();
  });

  it('stores a blob for a year and serves it back, touching it', async () => {
    const keys = mediaCacheKeys(SRC, BOX, 'cover')!;
    const blob = fakeBlob(20_000);

    await writeCachedMedia({ key: keys.derivative, originalKey: keys.original, url: SRC, blob });

    const stored = await memory.get(keys.derivative);

    expect(stored).toMatchObject({ bytes: 20_000, createdAt: NOW, validTill: NOW + MEDIA_CACHE_MAX_AGE_MS });

    (Date.now as jest.Mock).mockReturnValue(NOW + 1000);
    await expect(readCachedMedia(keys.derivative)).resolves.toBe(blob);
    await Promise.resolve();
    expect((await memory.get(keys.derivative))?.touchedAt).toBe(NOW + 1000);
  });

  it('skips an original over the size limit but keeps its derivatives', async () => {
    const keys = mediaCacheKeys(SRC, BOX, 'cover')!;

    await writeCachedMedia({
      key: keys.original,
      originalKey: keys.original,
      url: SRC,
      blob: fakeBlob(MEDIA_CACHE_MAX_ORIGINAL_BYTES + 1),
    });
    await writeCachedMedia({ key: keys.derivative, originalKey: keys.original, url: SRC, blob: fakeBlob(20_000) });

    expect((await memory.all()).map((record) => record.key)).toEqual([keys.derivative]);
  });

  it('drops an expired entry and its derivatives on read', async () => {
    const keys = mediaCacheKeys(SRC, BOX, 'cover')!;

    await writeCachedMedia({ key: keys.original, originalKey: keys.original, url: SRC, blob: fakeBlob(5_000_000) });
    await writeCachedMedia({ key: keys.derivative, originalKey: keys.original, url: SRC, blob: fakeBlob(20_000) });

    (Date.now as jest.Mock).mockReturnValue(NOW + MEDIA_CACHE_MAX_AGE_MS);
    await expect(readCachedMedia(keys.original)).resolves.toBeNull();
    expect(await memory.all()).toEqual([]);
  });

  it('removes an original together with its derivatives only', async () => {
    const keys = mediaCacheKeys(SRC, BOX, 'cover')!;
    const other = mediaCacheKeys(`${SRC}-2`, BOX, 'cover')!;

    await writeCachedMedia({ key: keys.original, originalKey: keys.original, url: SRC, blob: fakeBlob(5_000_000) });
    await writeCachedMedia({ key: keys.derivative, originalKey: keys.original, url: SRC, blob: fakeBlob(20_000) });
    await writeCachedMedia({ key: other.derivative, originalKey: other.original, url: SRC, blob: fakeBlob(20_000) });

    await removeCachedOriginal(keys.original);

    expect((await memory.all()).map((record) => record.key)).toEqual([other.derivative]);
  });

  describe('trimMediaCache', () => {
    it('drops expired entries with their derivatives', async () => {
      const keys = mediaCacheKeys(SRC, BOX, 'cover')!;
      const fresh = mediaCacheKeys(`${SRC}-fresh`, BOX, 'cover')!;

      await writeCachedMedia({ key: keys.original, originalKey: keys.original, url: SRC, blob: fakeBlob(100) });
      (Date.now as jest.Mock).mockReturnValue(NOW + 1000);
      await writeCachedMedia({ key: keys.derivative, originalKey: keys.original, url: SRC, blob: fakeBlob(10) });
      await writeCachedMedia({ key: fresh.original, originalKey: fresh.original, url: SRC, blob: fakeBlob(100) });

      // The original expired; its newer derivative goes with it.
      await trimMediaCache(NOW + MEDIA_CACHE_MAX_AGE_MS);

      expect((await memory.all()).map((record) => record.key)).toEqual([fresh.original]);
    });

    it('evicts the oldest-touched entries beyond the byte budget', async () => {
      const big = Math.ceil(MEDIA_CACHE_BUDGET_BYTES / 2);
      const keys = ['a', 'b', 'c'].map((name) => mediaCacheKeys(`${SRC}-${name}`, BOX, 'cover')!);

      // Inserted directly: `writeCachedMedia` would refuse originals this large.
      for (const [index, key] of keys.entries()) {
        await memory.put({
          key: key.original,
          originalKey: key.original,
          url: SRC,
          blob: fakeBlob(big),
          bytes: big,
          createdAt: NOW,
          validTill: NOW + MEDIA_CACHE_MAX_AGE_MS,
          touchedAt: NOW + index,
        });
      }

      await trimMediaCache(NOW + 10);

      expect((await memory.all()).map((record) => record.key)).toEqual([keys[1].original, keys[2].original]);
    });

    it('evicts beyond the entry limit', async () => {
      for (let index = 0; index <= MEDIA_CACHE_MAX_ENTRIES; index++) {
        const key = `v1|user-1|${SRC}-${index}`;

        await memory.put({ key, originalKey: key, url: SRC, blob: fakeBlob(1), bytes: 1, createdAt: NOW, validTill: NOW + 1, touchedAt: NOW + index });
      }

      await trimMediaCache(NOW);

      const left = await memory.all();

      expect(left).toHaveLength(MEDIA_CACHE_MAX_ENTRIES);
      expect(left.some((record) => record.touchedAt === NOW)).toBe(false);
    });
  });

  it('turns itself off after a storage error', async () => {
    setMediaDiskCacheStorageForTests({
      ...memory,
      get: async () => {
        throw new Error('quota');
      },
    });

    await expect(readCachedMedia('v1|user-1|x')).resolves.toBeNull();
    expect(mediaCacheKeys(SRC, BOX, 'cover')).toBeNull();
  });
});
