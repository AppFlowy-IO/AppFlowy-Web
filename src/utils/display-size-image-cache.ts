import { DecodeBox, DisplayFit, decodeBoxKey } from '@/utils/display-size-image';
import { fetchImageBlob } from '@/utils/image';
import { Log } from '@/utils/log';
import { mediaCacheKeys, readCachedMedia, writeCachedMedia } from '@/utils/media-disk-cache';

/**
 * Blob URLs of images decoded at their display size, shared by every mounted
 * image with the same source, box bucket and fit: the web counterpart of
 * Flutter's `ImageCache` entry per `BoxFitResizeImageKey`.
 *
 * An entry stays alive while a holder has it. Released entries are retained,
 * oldest first, within `RETAINED_BYTES_BUDGET` so a card scrolled back into
 * view or a bucket crossed and crossed back does not decode again. Failed
 * loads are forgotten so the next mount retries.
 *
 * Below this in-page layer, originals and thumbnails are persisted for a year
 * in `media-disk-cache.ts`, so a reload shows thumbnails without downloading
 * or decoding anything.
 */

export interface DisplaySizeImageHandle {
  /** A blob URL that stays valid until `release()`, or null when the image could not be fetched. */
  readonly url: Promise<string | null>;
  release(): void;
}

interface Entry {
  key: string;
  url: Promise<string | null>;
  resolvedUrl: string | null;
  bytes: number;
  refs: number;
}

type ResizeModule = typeof import('@/utils/display-size-image-resize');

/** Thumbnails are 2–130 KB, so this holds hundreds; an unbounded box keeps the original and uses it up faster. */
const RETAINED_BYTES_BUDGET = 32 * 1024 * 1024;

const entries = new Map<string, Entry>();
/** Entries without holders, in release order. */
const retained = new Map<string, Entry>();
let retainedBytes = 0;
let resizeModule: Promise<ResizeModule | null> | null = null;

/**
 * The canvas pipeline is loaded on first use so it stays out of the shared
 * app chunk. A failed `import()` stays failed for the life of the page, so
 * thumbnails then show the original image until the next page load.
 */
function loadResizeModule(): Promise<ResizeModule | null> {
  resizeModule ??= import('@/utils/display-size-image-resize').catch((error: unknown) => {
    Log.warn('[displaySizeImage] could not load the resize pipeline, showing originals', error);
    return null;
  });

  return resizeModule;
}

async function loadDisplaySizeImage(src: string, box: DecodeBox, fit: DisplayFit): Promise<Blob | null> {
  // A thumbnail already on disk needs neither a download nor a decode. The
  // resize pipeline loads alongside the lookup instead of after it.
  const disk = mediaCacheKeys(src, box, fit);
  const [cachedThumbnail, resizer] = await Promise.all([
    disk ? readCachedMedia(disk.derivative) : null,
    loadResizeModule(),
  ]);

  if (cachedThumbnail) return cachedThumbnail;

  // Local-first like desktop: a cached original is never fetched again.
  // `fetchImageBlob` sends the bearer token, falls back to an anonymous
  // request for published files and transcodes HEIC/TIFF to PNG.
  const cachedOriginal = disk ? await readCachedMedia(disk.original) : null;
  const original = cachedOriginal ?? (await fetchImageBlob(src));

  if (!original) return null;
  if (disk && !cachedOriginal) {
    void writeCachedMedia({ key: disk.original, originalKey: disk.original, url: src, blob: original });
  }

  if (!resizer) return original;

  try {
    const result = await resizer.resizeImageBlob(original, box, fit);

    if (result.resized) {
      Log.debug(
        `[displaySizeImage] ${result.intrinsic?.width}×${result.intrinsic?.height} → ${result.target?.width}×${result.target?.height} for ${decodeBoxKey(box, fit)} (${original.size} → ${result.blob.size} bytes)`
      );
      if (disk) void writeCachedMedia({ key: disk.derivative, originalKey: disk.original, url: src, blob: result.blob });
    }

    return result.blob;
  } catch (error) {
    Log.warn('[displaySizeImage] could not resize the image, showing the original', error);
    return original;
  }
}

function forget(entry: Entry): void {
  if (entries.get(entry.key) === entry) entries.delete(entry.key);
  if (entry.resolvedUrl) {
    URL.revokeObjectURL(entry.resolvedUrl);
    entry.resolvedUrl = null;
  }
}

function unretain(entry: Entry): void {
  if (retained.delete(entry.key)) retainedBytes -= entry.bytes;
}

function retain(entry: Entry): void {
  retained.set(entry.key, entry);
  retainedBytes += entry.bytes;

  for (const oldest of retained.values()) {
    if (retainedBytes <= RETAINED_BYTES_BUDGET) break;
    unretain(oldest);
    forget(oldest);
  }
}

function release(entry: Entry): void {
  entry.refs = Math.max(0, entry.refs - 1);

  if (entry.refs > 0 || entries.get(entry.key) !== entry) return;
  // Still loading: the load settles it (see `createEntry`).
  if (entry.resolvedUrl === null) return;

  retain(entry);
}

function createEntry(key: string, src: string, box: DecodeBox, fit: DisplayFit): Entry {
  const entry: Entry = { key, url: Promise.resolve(null), resolvedUrl: null, bytes: 0, refs: 1 };

  entry.url = loadDisplaySizeImage(src, box, fit).then((blob) => {
    if (entries.get(key) !== entry) return null;

    if (!blob) {
      forget(entry);
      return null;
    }

    entry.resolvedUrl = URL.createObjectURL(blob);
    entry.bytes = blob.size;
    // Every holder released it before it loaded.
    if (entry.refs === 0) retain(entry);

    return entry.resolvedUrl;
  });

  return entry;
}

/**
 * Loads `src` decoded for `box` under `fit`, or joins the load already in
 * flight or retained for that key. Release the handle when the image is no
 * longer shown; releasing twice is a no-op.
 */
export function acquireDisplaySizeImage(src: string, box: DecodeBox, fit: DisplayFit): DisplaySizeImageHandle {
  const key = `${src}|${decodeBoxKey(box, fit)}`;
  let entry = entries.get(key);

  if (entry) {
    unretain(entry);
    entry.refs += 1;
  } else {
    entry = createEntry(key, src, box, fit);
    entries.set(key, entry);
  }

  const acquired = entry;
  let released = false;

  return {
    url: acquired.url,
    release() {
      if (released) return;
      released = true;
      release(acquired);
    },
  };
}

/** Test support: drops every entry and revokes its URL. */
export function clearDisplaySizeImageCache(): void {
  for (const entry of entries.values()) forget(entry);
  entries.clear();
  retained.clear();
  retainedBytes = 0;
}

/** Test support. */
export function displaySizeImageCacheStats(): { entries: number; retained: number; retainedBytes: number } {
  return { entries: entries.size, retained: retained.size, retainedBytes };
}
