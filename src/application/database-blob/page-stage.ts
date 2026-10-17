const DB_NAME = 'AppFlowyDatabaseBlobDiffPageStage';
const DB_VERSION = 1;
const STORE_NAME = 'pages';
const WALK_ID_INDEX = 'walkId';
const CREATED_AT_INDEX = 'createdAt';
const STALE_PAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Browsers without usable IndexedDB can still complete small walks, but must
 * never restore the old unbounded heap behaviour. Two maximum-sized pages
 * leave enough room for ordinary pagination while providing a hard ceiling.
 */
export const DATABASE_BLOB_PAGE_STAGE_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

type StagedPageRecord = {
  walkId: string;
  pageIndex: number;
  bytes: Uint8Array;
  createdAt: number;
};

export interface DatabaseBlobDiffPageStage {
  readonly pageCount: number;
  readonly byteLength: number;
  append(bytes: Uint8Array): Promise<void>;
  read(pageIndex: number): Promise<Uint8Array>;
  clear(): Promise<void>;
}

export class DatabaseBlobDiffPageStageCapacityError extends Error {
  constructor(byteLength: number, limitBytes = DATABASE_BLOB_PAGE_STAGE_MEMORY_LIMIT_BYTES) {
    super(`database blob diff page staging exceeded the ${limitBytes}-byte memory limit (${byteLength} bytes)`);
    this.name = 'DatabaseBlobDiffPageStageCapacityError';
  }
}

let databasePromise: Promise<IDBDatabase | null> | null = null;
let walkSequence = 0;

function createWalkId() {
  walkSequence += 1;
  return `${Date.now()}-${walkSequence}-${Math.random().toString(36).slice(2)}`;
}

function canUseIndexedDB() {
  return typeof indexedDB !== 'undefined';
}

function deleteByCursor(database: IDBDatabase, indexName: string, range: IDBKeyRange): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const index = transaction.objectStore(STORE_NAME).index(indexName);
    const request = index.openCursor(range);

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('failed to enumerate staged database blob pages'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('failed to delete staged database blob pages'));
    transaction.onabort = () => reject(transaction.error ?? new Error('staged database blob page deletion aborted'));
  });
}

function removeExpiredPages(database: IDBDatabase) {
  const expiresBefore = Date.now() - STALE_PAGE_MAX_AGE_MS;

  void deleteByCursor(database, CREATED_AT_INDEX, IDBKeyRange.upperBound(expiresBefore)).catch(() => undefined);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDB()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;

    request.onerror = () => {
      if (settled) {
        databasePromise = null;
        return;
      }

      settled = true;
      databasePromise = null;
      resolve(null);
    };

    request.onblocked = () => {
      if (settled) return;

      // Do not leave a page walk waiting indefinitely on another connection.
      // This request remains the cached attempt until it eventually succeeds or
      // errors, while the current walk uses the bounded in-memory fallback.
      settled = true;
      resolve(null);
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (database.objectStoreNames.contains(STORE_NAME)) return;

      const store = database.createObjectStore(STORE_NAME, {
        keyPath: ['walkId', 'pageIndex'],
      });

      store.createIndex(WALK_ID_INDEX, WALK_ID_INDEX, { unique: false });
      store.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX, { unique: false });
    };

    request.onsuccess = () => {
      const database = request.result;

      if (settled) {
        database.close();
        databasePromise = null;
        return;
      }

      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };

      settled = true;
      resolve(database);
      removeExpiredPages(database);
    };
  });

  return databasePromise;
}

function putPage(database: IDBDatabase, record: StagedPageRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');

    transaction.objectStore(STORE_NAME).put(record);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('failed to stage database blob page'));
    transaction.onabort = () => reject(transaction.error ?? new Error('database blob page staging aborted'));
  });
}

function getPage(database: IDBDatabase, walkId: string, pageIndex: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get([walkId, pageIndex]);

    request.onsuccess = () => {
      const record = request.result as StagedPageRecord | undefined;

      if (!record) {
        reject(new Error(`database blob diff staged page ${pageIndex} is missing`));
        return;
      }

      resolve(record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes));
    };

    request.onerror = () => reject(request.error ?? new Error('failed to read staged database blob page'));
  });
}

class PageStage implements DatabaseBlobDiffPageStage {
  private readonly walkId = createWalkId();
  private readonly memoryPages = new Map<number, Uint8Array>();
  private backend: 'unknown' | 'indexeddb' | 'memory' = 'unknown';
  private count = 0;
  private bytes = 0;

  constructor(private readonly memoryLimitBytes: number) {}

  get pageCount() {
    return this.count;
  }

  get byteLength() {
    return this.bytes;
  }

  async append(bytes: Uint8Array) {
    const nextByteLength = this.bytes + bytes.byteLength;
    const database = this.backend === 'memory' ? null : await openDatabase();

    if (database) {
      await putPage(database, {
        walkId: this.walkId,
        pageIndex: this.count,
        bytes,
        createdAt: Date.now(),
      });
      this.backend = 'indexeddb';
    } else {
      if (this.backend === 'indexeddb') {
        throw new Error('database blob diff page stage became unavailable');
      }

      if (nextByteLength > this.memoryLimitBytes) {
        throw new DatabaseBlobDiffPageStageCapacityError(nextByteLength, this.memoryLimitBytes);
      }

      this.backend = 'memory';
      // Own exactly these bytes; Buffer/typed-array views can otherwise keep a
      // much larger pooled backing buffer alive than their byteLength reports.
      this.memoryPages.set(this.count, new Uint8Array(bytes));
    }

    this.count += 1;
    this.bytes = nextByteLength;
  }

  async read(pageIndex: number) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.count) {
      throw new Error(`database blob diff staged page ${pageIndex} is out of range`);
    }

    if (this.backend === 'memory') {
      const page = this.memoryPages.get(pageIndex);

      if (!page) throw new Error(`database blob diff staged page ${pageIndex} is missing`);
      return page;
    }

    const database = await openDatabase();

    if (!database) throw new Error('database blob diff page stage is unavailable');
    return getPage(database, this.walkId, pageIndex);
  }

  async clear() {
    this.memoryPages.clear();

    try {
      if (this.backend === 'indexeddb') {
        const database = await openDatabase();

        if (database) {
          await deleteByCursor(database, WALK_ID_INDEX, IDBKeyRange.only(this.walkId));
        }
      }
    } catch {
      // Staged pages are disposable. Expiration cleanup removes leftovers from
      // interrupted walks without making a successful prefetch fail.
    } finally {
      this.backend = 'unknown';
      this.count = 0;
      this.bytes = 0;
    }
  }
}

export function createDatabaseBlobDiffPageStage(options?: { memoryLimitBytes?: number }): DatabaseBlobDiffPageStage {
  return new PageStage(options?.memoryLimitBytes ?? DATABASE_BLOB_PAGE_STAGE_MEMORY_LIMIT_BYTES);
}
