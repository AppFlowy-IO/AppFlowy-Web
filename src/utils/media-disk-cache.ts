import Dexie, { Table } from 'dexie';

import { getTokenParsed } from '@/application/session/token';
import { DecodeBox, DisplayFit, decodeBoxKey } from '@/utils/display-size-image';
import { Log } from '@/utils/log';

/**
 * Persistent media cache in IndexedDB: the web counterpart of desktop's
 * `LocalFirstCacheManager` + `ScopedImageCacheManager`.
 *
 * - Entries are namespaced by the signed-in identity, never by the token, so
 *   two accounts in one browser profile never see each other's files.
 * - Reads are local-first: a cached file is used without a network request.
 * - A resized derivative is keyed under its original and removed with it.
 * - Entries expire after a year; capacity, not freshness, drives eviction,
 *   oldest-touched first. Maintenance runs deferred and never blocks a read.
 *
 * Anonymous viewers are not cached here: published files are `immutable` for
 * a year in the browser's own HTTP cache already.
 */

export interface MediaCacheRecord {
  key: string;
  /** The original's key; equal to `key` for an original. Derivatives go when it goes. */
  originalKey: string;
  /** The resource URL without credentials, for debugging. */
  url: string;
  blob: Blob;
  bytes: number;
  createdAt: number;
  validTill: number;
  touchedAt: number;
}

export interface MediaCacheStorage {
  get(key: string): Promise<MediaCacheRecord | undefined>;
  put(record: MediaCacheRecord): Promise<void>;
  touch(key: string, touchedAt: number): Promise<void>;
  remove(keys: string[]): Promise<void>;
  keysByOriginal(originalKey: string): Promise<string[]>;
  /** Every record's metadata, blobs included only as handles IndexedDB does not read until used. */
  all(): Promise<MediaCacheRecord[]>;
}

export interface MediaCacheKeys {
  original: string;
  derivative: string;
}

const DB_NAME = 'AppFlowyMediaCache';
const KEY_VERSION = 'v1';

/** Desktop keeps downloaded images for a year. */
export const MEDIA_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
/** Capacity for the whole store; desktop trims by object count, the web by bytes too. */
export const MEDIA_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;
export const MEDIA_CACHE_MAX_ENTRIES = 2000;
/** Originals above this (a transcoded HEIC can reach 30 MB) keep only their derivatives. */
export const MEDIA_CACHE_MAX_ORIGINAL_BYTES = 24 * 1024 * 1024;
const MAINTENANCE_DELAY_MS = 60 * 1000;

class MediaCacheDatabase extends Dexie {
  media!: Table<MediaCacheRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ media: 'key, originalKey, touchedAt' });
  }
}

function createIndexedDbStorage(): MediaCacheStorage {
  const db = new MediaCacheDatabase();

  return {
    get: (key) => db.media.get(key),
    put: async (record) => {
      await db.media.put(record);
    },
    touch: async (key, touchedAt) => {
      await db.media.update(key, { touchedAt });
    },
    remove: (keys) => db.media.bulkDelete(keys),
    keysByOriginal: (originalKey) => db.media.where('originalKey').equals(originalKey).primaryKeys(),
    all: () => db.media.toArray(),
  };
}

/** Test support: the same policy over a Map. */
export function createMemoryMediaCacheStorage(): MediaCacheStorage {
  const records = new Map<string, MediaCacheRecord>();

  return {
    get: async (key) => records.get(key),
    put: async (record) => {
      records.set(record.key, record);
    },
    touch: async (key, touchedAt) => {
      const record = records.get(key);

      if (record) records.set(key, { ...record, touchedAt });
    },
    remove: async (keys) => {
      keys.forEach((key) => records.delete(key));
    },
    keysByOriginal: async (originalKey) =>
      [...records.values()].filter((record) => record.originalKey === originalKey).map((record) => record.key),
    all: async () => [...records.values()],
  };
}

let storage: MediaCacheStorage | null | undefined;
let maintenanceTimer: ReturnType<typeof setTimeout> | null = null;

function getStorage(): MediaCacheStorage | null {
  if (storage !== undefined) return storage;

  storage = typeof indexedDB === 'undefined' ? null : createIndexedDbStorage();

  return storage;
}

/** Turns the store off for the rest of the session after a failure, so a broken IndexedDB costs one error, not one per image. */
function disable(error: unknown): void {
  Log.warn('[mediaDiskCache] disabled after a storage error', error);
  storage = null;
}

/** Test support. */
export function setMediaDiskCacheStorageForTests(next: MediaCacheStorage | null | undefined): void {
  storage = next;
  if (maintenanceTimer) {
    clearTimeout(maintenanceTimer);
    maintenanceTimer = null;
  }
}

/**
 * The keys for `src` in the current identity's namespace, or null when there
 * is no signed-in identity or no storage.
 */
export function mediaCacheKeys(src: string, box: DecodeBox, fit: DisplayFit): MediaCacheKeys | null {
  if (!getStorage()) return null;

  const identity = getTokenParsed()?.user.id;

  if (!identity) return null;

  const original = `${KEY_VERSION}|${identity}|${src}`;

  return { original, derivative: `${original}|${decodeBoxKey(box, fit)}` };
}

/** The cached blob for `key`, or null. An expired entry is dropped on read. */
export async function readCachedMedia(key: string): Promise<Blob | null> {
  const store = getStorage();

  if (!store) return null;

  try {
    const record = await store.get(key);

    if (!record) return null;

    const now = Date.now();

    if (record.validTill <= now) {
      await removeCachedOriginal(record.originalKey);
      return null;
    }

    void store.touch(key, now).catch(() => undefined);

    return record.blob;
  } catch (error) {
    disable(error);
    return null;
  }
}

export interface WriteCachedMediaOptions {
  key: string;
  originalKey: string;
  url: string;
  blob: Blob;
}

/** Stores a blob for a year. An original over `MEDIA_CACHE_MAX_ORIGINAL_BYTES` is skipped; its derivatives are still kept. */
export async function writeCachedMedia({ key, originalKey, url, blob }: WriteCachedMediaOptions): Promise<void> {
  const store = getStorage();

  if (!store) return;
  if (key === originalKey && blob.size > MEDIA_CACHE_MAX_ORIGINAL_BYTES) return;

  const now = Date.now();

  try {
    await store.put({
      key,
      originalKey,
      url,
      blob,
      bytes: blob.size,
      createdAt: now,
      validTill: now + MEDIA_CACHE_MAX_AGE_MS,
      touchedAt: now,
    });
    scheduleMaintenance();
  } catch (error) {
    disable(error);
  }
}

/** Removes an original together with every derivative made from it. */
export async function removeCachedOriginal(originalKey: string): Promise<void> {
  const store = getStorage();

  if (!store) return;

  try {
    const keys = await store.keysByOriginal(originalKey);

    await store.remove(keys.includes(originalKey) ? keys : [...keys, originalKey]);
  } catch (error) {
    disable(error);
  }
}

function scheduleMaintenance(): void {
  if (maintenanceTimer) return;

  maintenanceTimer = setTimeout(() => {
    maintenanceTimer = null;
    void trimMediaCache().catch((error) => Log.warn('[mediaDiskCache] maintenance failed', error));
  }, MAINTENANCE_DELAY_MS);
}

/**
 * Drops expired entries, then the oldest-touched ones until the store is
 * within its byte and entry budgets. A derivative never outlives its original.
 */
export async function trimMediaCache(now = Date.now()): Promise<void> {
  const store = getStorage();

  if (!store) return;

  const records = await store.all();
  const originalsToDrop = new Set<string>();
  let live = records.filter((record) => {
    if (record.validTill > now) return true;
    originalsToDrop.add(record.originalKey);
    return false;
  });

  live.sort((a, b) => b.touchedAt - a.touchedAt);

  let bytes = live.reduce((total, record) => total + record.bytes, 0);

  while (live.length > 0 && (live.length > MEDIA_CACHE_MAX_ENTRIES || bytes > MEDIA_CACHE_BUDGET_BYTES)) {
    const oldest = live.pop() as MediaCacheRecord;

    bytes -= oldest.bytes;
    originalsToDrop.add(oldest.originalKey);
  }

  if (originalsToDrop.size === 0) return;

  live = live.filter((record) => !originalsToDrop.has(record.originalKey));
  const keep = new Set(live.map((record) => record.key));

  await store.remove(records.map((record) => record.key).filter((key) => !keep.has(key)));
}
