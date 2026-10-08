import * as Y from 'yjs';

import { databasePrefix } from '@/application/constants';
import { DATABASE_CACHE_EPOCH_PREFIX } from '@/application/db/database-storage-fence';

import { REPAIR_TIMEOUT_MS, REPAIR_MAX_SOURCE_BYTES, REPAIR_MAX_SOURCE_UPDATES, type RepairRequest, type RepairUpdate } from './types';

const SHARED_DATABASE = `${databasePrefix}_cache`;
const EPOCH_KEY = '__storage_epoch';

function check(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Repair read cancelled');
}

/** Opening a missing database aborts its creation; donor reads never initialize local storage. */
function openExisting(name: string, signal: AbortSignal): Promise<IDBDatabase | undefined> {
  check(signal);
  return new Promise((resolve, reject) => {
    let missing = false;
    let settled = false;
    const request = indexedDB.open(name);
    const finish = (database?: IDBDatabase, error?: unknown) => {
      if (settled) {
        database?.close();
        return;
      }

      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(database);
    };

    const abort = () => finish(undefined, new Error('Repair read cancelled'));

    signal.addEventListener('abort', abort, { once: true });
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };

    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(undefined, missing ? undefined : request.error);
    request.onblocked = () => finish(undefined);
    if (signal.aborted) abort();
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readTransaction<T>(
  database: IDBDatabase,
  stores: string[],
  signal: AbortSignal,
  read: (transaction: IDBTransaction) => Promise<T>
): Promise<T> {
  check(signal);
  const transaction = database.transaction(stores, 'readonly');
  const abort = () => {
    try {
      transaction.abort();
    } catch {
      /* Already completed. */
    }
  };

  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Repair transaction aborted'));
    transaction.onerror = () => reject(transaction.error);
  });

  signal.addEventListener('abort', abort, { once: true });
  try {
    const [value] = await Promise.all([read(transaction), completion]);

    check(signal);
    return value;
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('Invalid persisted repair update');
}

class SourceUpdates {
  readonly updates: Uint8Array[] = [];
  private byteLength = 0;

  add(value: unknown): void {
    const update = bytes(value);

    this.byteLength += update.byteLength;
    if (this.byteLength > REPAIR_MAX_SOURCE_BYTES || this.updates.length >= REPAIR_MAX_SOURCE_UPDATES)
      throw new Error('Repair source exceeds read budget');
    this.updates.push(update);
  }
}

function readCursor(request: IDBRequest<IDBCursorWithValue | null>, consume: (value: unknown) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        resolve();
        return;
      }

      try {
        consume(cursor.value);
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

interface Metadata {
  version?: string;
  epoch?: string;
  databaseEpoch?: string;
}
type CustomRecord = { value?: unknown } | undefined;

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid persisted repair metadata');
  return value;
}

async function sharedMetadata(transaction: IDBTransaction, request: RepairRequest): Promise<Metadata> {
  const custom = transaction.objectStore('collab_custom');
  const [version, epoch, databaseEpoch] = await Promise.all([
    result<CustomRecord>(custom.get([request.objectId, `${request.objectId}/version`])),
    result<CustomRecord>(custom.get([request.objectId, EPOCH_KEY])),
    result<CustomRecord>(custom.get([`database-blob-epoch:${request.databaseId}`, EPOCH_KEY])),
  ]);

  return {
    version: optionalString(version?.value),
    epoch: optionalString(epoch?.value),
    databaseEpoch: optionalString(databaseEpoch?.value),
  };
}

function matchesGeneration(request: RepairRequest, metadata: Metadata): boolean {
  if (metadata.version !== request.version) return false;
  if (request.collabType === 0) return true;
  // Absence is an untracked legacy cache, never proof of the original generation.
  const expected = request.databaseRestoreId;

  if (expected === undefined) return false;
  const shadow = localStorage.getItem(`${DATABASE_CACHE_EPOCH_PREFIX}${request.databaseId}`) ?? undefined;

  return (
    metadata.databaseEpoch === expected &&
    shadow === expected &&
    (request.collabType !== 4 || metadata.epoch === expected)
  );
}

/** Reads a coherent local copy without providers, cache population, migration or version reset. */
export async function readPersistedRepairUpdate(
  request: RepairRequest,
  signal: AbortSignal
): Promise<RepairUpdate | undefined> {
  if (typeof indexedDB === 'undefined') return;
  check(signal);
  const startedAt = performance.now();
  const checkDeadline = () => {
    check(signal);
    if (performance.now() - startedAt >= REPAIR_TIMEOUT_MS) throw new Error('Repair read deadline exceeded');
  };

  const databases: IDBDatabase[] = [];
  let invalidated = false;
  const open = async (name: string) => {
    const database = await openExisting(name, signal);

    if (database) {
      databases.push(database);
      database.onversionchange = () => {
        invalidated = true;
        database.close();
      };
    }

    return database;
  };

  let doc: Y.Doc | undefined;

  try {
    const source = new SourceUpdates();
    let metadata: Metadata;
    let verify: () => Promise<Metadata>;

    if (request.collabType === 4) {
      const database = await open(SHARED_DATABASE);

      if (
        !database ||
        !['collab_snapshots', 'collab_updates', 'collab_custom'].every((name) =>
          database.objectStoreNames.contains(name)
        )
      )
        return;
      metadata = await readTransaction(
        database,
        ['collab_snapshots', 'collab_updates', 'collab_custom'],
        signal,
        async (transaction) => {
          const metadataPromise = sharedMetadata(transaction, request);
          const snapshotPromise = result<{ update?: unknown; version?: string } | undefined>(
            transaction.objectStore('collab_snapshots').get(request.objectId)
          );
          const tail = new SourceUpdates();
          const tailPromise = readCursor(
            transaction
              .objectStore('collab_updates')
              .index('[objectId+id]')
              .openCursor(IDBKeyRange.bound([request.objectId, 0], [request.objectId, Number.MAX_SAFE_INTEGER])),
            (value) => tail.add((value as { update: unknown }).update)
          );
          const [loaded, snapshot] = await Promise.all([metadataPromise, snapshotPromise, tailPromise]);

          if (snapshot?.version !== undefined && snapshot?.version !== null && snapshot.version !== loaded.version)
            throw new Error('Repair snapshot version mismatch');
          if (snapshot?.update) source.add(snapshot.update);
          for (const update of tail.updates) source.add(update);
          return loaded;
        }
      );
      verify = () =>
        readTransaction(database, ['collab_custom'], signal, (transaction) => sharedMetadata(transaction, request));
    } else {
      const restoreId = request.databaseRestoreId;
      const name = restoreId ? `${request.objectId}:database-restore:${restoreId}` : request.objectId;
      const database = await open(name);

      if (!database || !database.objectStoreNames.contains('updates') || !database.objectStoreNames.contains('custom'))
        return;
      const readMetadata = async (): Promise<Metadata> => {
        const version = await readTransaction(database, ['custom'], signal, (transaction) =>
          result(transaction.objectStore('custom').get(`${request.objectId}/version`))
        );
        let databaseEpoch: string | undefined;

        if (request.collabType === 1) {
          const shared = databases.find((entry) => entry.name === SHARED_DATABASE) ?? (await open(SHARED_DATABASE));

          if (!shared || !shared.objectStoreNames.contains('collab_custom')) {
            throw new Error('Missing database repair generation');
          } else {
            const record = await readTransaction(shared, ['collab_custom'], signal, (transaction) =>
              result<CustomRecord>(
                transaction.objectStore('collab_custom').get([`database-blob-epoch:${request.objectId}`, EPOCH_KEY])
              )
            );

            databaseEpoch = optionalString(record?.value);
          }
        }

        return { version: optionalString(version), databaseEpoch };
      };

      metadata = await readMetadata();
      if (!matchesGeneration(request, metadata)) return;
      await readTransaction(database, ['updates', 'custom'], signal, async (transaction) => {
        const versionPromise = result(transaction.objectStore('custom').get(`${request.objectId}/version`));

        await readCursor(transaction.objectStore('updates').openCursor(), (value) => source.add(value));
        if (optionalString(await versionPromise) !== metadata.version)
          throw new Error('Repair version changed during read');
      });
      verify = readMetadata;
    }

    if (source.updates.length === 0 || invalidated || !matchesGeneration(request, metadata)) return;
    doc = new Y.Doc({ guid: request.objectId });
    let batchStartedAt = performance.now();

    for (const update of source.updates) {
      checkDeadline();
      Y.applyUpdate(doc, update);
      if (performance.now() - batchStartedAt >= 8) {
        // Let logout/restore events and cancellation run during large journal replays.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkDeadline();
        batchStartedAt = performance.now();
      }
    }

    checkDeadline();
    // A self-contained donation must not propagate the same unresolved dependencies.
    if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) return;
    const root = doc.getMap('data');
    const body = root.get(request.collabType === 0 ? 'document' : request.collabType === 1 ? 'database' : 'data');

    if (!(body instanceof Y.Map)) return;
    if (
      request.collabType === 4 &&
      (body.get('id') !== request.objectId || body.get('database_id') !== request.databaseId)
    )
      return;
    if (request.collabType === 1 && body.get('id') !== request.objectId) return;
    const payload = Y.encodeStateAsUpdate(doc, request.stateVector);

    checkDeadline();
    if (payload.byteLength > request.maxUpdateBytes || (payload.length === 2 && payload[0] === 0 && payload[1] === 0))
      return;
    const current = await verify();

    checkDeadline();
    if (invalidated || !matchesGeneration(request, current) || current.epoch !== metadata.epoch) return;
    return {
      objectId: request.objectId,
      collabType: request.collabType,
      payload,
      version: metadata.version,
      databaseRestoreId: request.collabType === 0 ? undefined : metadata.databaseEpoch,
      beforeStateVector: request.stateVector,
    };
  } finally {
    doc?.destroy();
    databases.forEach((database) => database.close());
  }
}
