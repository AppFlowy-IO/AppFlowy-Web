import * as Y from 'yjs';

import { assertCollabStorageCurrent, collabStorageKey } from '@/application/db/collab-storage-scope';
import type { DatabaseStorageFence } from '@/application/db/database-storage-fence';
import type { CollabFullSyncBatchResult } from '@/application/services/js-services/http/collab-api';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('Database creation cancelled');
}

export const ORIGINAL_DATABASE_RESTORE_ID = '00000000-0000-0000-0000-000000000000';

/** Capture live and durable histories independently: combining them could hide a missing fragment. */
export interface DatabaseViewSourceRequirements {
  databaseId: string;
  restoreId: string;
  version?: string;
  live: Uint8Array;
  persisted: Uint8Array;
}

function completeDocument(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();

  try {
    Y.applyUpdate(doc, update);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Database history is incomplete');
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

function covers(remote: Y.Doc, required: Y.Doc): boolean {
  const actualClocks = Y.decodeStateVector(Y.encodeStateVector(remote));
  const requiredClocks = Y.decodeStateVector(Y.encodeStateVector(required));

  for (const [client, clock] of requiredClocks) {
    if ((actualClocks.get(client) ?? 0) < clock) return false;
  }

  // State vectors alone cannot prove deletion-only edits reached the server.
  const actualDeletes = Y.createDeleteSetFromStructStore(remote.store).clients;
  const requiredDeletes = Y.createDeleteSetFromStructStore(required.store).clients;

  for (const [client, ranges] of requiredDeletes) {
    const actual = actualDeletes.get(client) ?? [];

    for (const range of ranges) {
      let cursor = range.clock;
      const end = range.clock + range.len;

      for (const candidate of actual) {
        if (candidate.clock > cursor) break;
        if (candidate.clock + candidate.len > cursor) cursor = candidate.clock + candidate.len;
        if (cursor >= end) break;
      }

      if (cursor < end) return false;
    }
  }

  return true;
}

/** Read-only proof against an independently decoded server root; never upload or merge local bytes. */
export function remoteDatabaseCoversSource(
  requirements: DatabaseViewSourceRequirements,
  result: CollabFullSyncBatchResult
): boolean {
  if (result.error || result.objectId !== requirements.databaseId || result.collabType !== Types.Database ||
    result.collabVersion !== requirements.version) {
    throw new Error('Database source identity or version changed');
  }

  const remote = completeDocument(result.missingUpdate);
  const required: Y.Doc[] = [];

  try {
    const root = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    if (!(root instanceof Y.Map) || root.get(YjsDatabaseKey.id) !== requirements.databaseId) {
      throw new Error('The server did not return the requested Database');
    }

    const actual = Y.encodeStateVector(remote);
    const reported = Y.decodeStateVector(result.serverStateVector);
    const decoded = Y.decodeStateVector(actual);

    if (reported.size !== decoded.size || [...reported].some(([client, clock]) => decoded.get(client) !== clock)) {
      throw new Error('Database response is missing server history');
    }

    for (const update of [requirements.live, requirements.persisted]) {
      const doc = completeDocument(update);

      required.push(doc);
      const localRoot = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

      // Empty persistence is valid before its first flush; a different root is never a source proof.
      if (Y.decodeStateVector(Y.encodeStateVector(doc)).size &&
        (!(localRoot instanceof Y.Map) || localRoot.get(YjsDatabaseKey.id) !== requirements.databaseId)) {
        throw new Error('Local Database history has a different identity');
      }
    }

    return required.every((doc) => covers(remote, doc));
  } finally {
    remote.destroy();
    required.forEach((doc) => doc.destroy());
  }
}

/** Observe normal sync progress under one deadline. Queue drain is not a source-coverage proof. */
export async function waitForDatabaseViewSource(
  requirements: DatabaseViewSourceRequirements,
  options: {
    read: (signal: AbortSignal, remainingMs: number) => Promise<CollabFullSyncBatchResult>;
    assertCurrent: () => void;
    signal: AbortSignal;
    deadline: number;
  }
): Promise<CollabFullSyncBatchResult> {
  while (!options.signal.aborted) {
    assertNotAborted(options.signal);
    options.assertCurrent();
    const remaining = options.deadline - Date.now();

    if (remaining <= 0) throw new Error('Database changes have not reached the server');
    const result = await options.read(options.signal, remaining);

    assertNotAborted(options.signal);
    options.assertCurrent();
    if (Date.now() >= options.deadline) throw new Error('Database source check expired');
    if (remoteDatabaseCoversSource(requirements, result)) return result;
    await new Promise<void>((resolve, reject) => {
      const done = () => { options.signal.removeEventListener('abort', abort); resolve(); };

      const timer = setTimeout(done, Math.min(100, options.deadline - Date.now()));
      const abort = () => { clearTimeout(timer); reject(options.signal.reason); };

      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
    });
  }

  assertNotAborted(options.signal);
  throw new Error('Database creation cancelled');
}

/** Read the existing y-indexeddb namespace without creating a provider or writing local history. */
export async function readPersistedDatabaseSource(
  doc: YDoc,
  signal: AbortSignal,
  storageFence: DatabaseStorageFence
): Promise<Uint8Array> {
  // History-enabled sync uses the nil UUID on the wire before the first restore.
  // Only a published cache epoch chooses a restored namespace, including an
  // explicit nil epoch after a reset back to the original generation.
  const restoreId = storageFence.cacheEpoch;

  assertNotAborted(signal);
  if (
    storageFence.databaseId !== doc.guid ||
    restoreId === undefined ||
    storageFence.epoch !== restoreId ||
    (doc.databaseRestoreId ?? ORIGINAL_DATABASE_RESTORE_ID) !== (restoreId ?? ORIGINAL_DATABASE_RESTORE_ID)
  ) {
    throw new Error('Database source storage generation changed');
  }

  // The root lives in this account and workspace's namespace of the current restore
  // generation. A document opened under another account or workspace is never read here.
  assertCollabStorageCurrent(doc);
  const storageName = collabStorageKey(doc.guid);
  const name = restoreId ? `${storageName}:database-restore:${restoreId}` : storageName;
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    assertNotAborted(signal);
    const request = indexedDB.open(name);
    let failed = false;
    const abort = () => { failed = true; request.transaction?.abort(); reject(signal.reason); };

    signal.addEventListener('abort', abort, { once: true });
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => { signal.removeEventListener('abort', abort); reject(request.error); };

    request.onblocked = () => { failed = true; signal.removeEventListener('abort', abort); reject(new Error('Database storage is blocked')); };

    request.onsuccess = () => {
      signal.removeEventListener('abort', abort);
      if (failed || signal.aborted) { request.result.close(); reject(signal.reason); } else resolve(request.result);
    };
  });

  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      assertNotAborted(signal);
      const transaction = connection.transaction(['updates', 'custom'], 'readonly');
      const updates = transaction.objectStore('updates').getAll();
      const version = transaction.objectStore('custom').get(`${doc.guid}/version`);
      const abort = () => transaction.abort();

      signal.addEventListener('abort', abort, { once: true });
      transaction.onabort = transaction.onerror = () => {
        signal.removeEventListener('abort', abort);
        reject(transaction.error ?? new Error('Database storage read aborted'));
      };

      transaction.oncomplete = () => {
        signal.removeEventListener('abort', abort);
        try {
          assertNotAborted(signal);
          if ((version.result ?? undefined) !== doc.version) throw new Error('Persisted Database version changed');
          resolve(updates.result.length ? Y.mergeUpdates(updates.result) : new Uint8Array([0, 0]));
        } catch (error) { reject(error); }
      };
    });
  } finally {
    connection.close();
  }
}
