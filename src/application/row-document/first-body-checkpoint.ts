import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

/** The body bytes and recovery marker must commit in the same existing Document database. */
export async function persistStagedBodyCheckpoint(
  doc: Y.Doc,
  provider: IndexeddbPersistence,
  stagingJson: string,
  options: { assertCurrent: () => void; signal: AbortSignal }
): Promise<void> {
  const assertCurrent = () => {
    if (options.signal.aborted) throw options.signal.reason ?? new Error('Row-page save was cancelled.');
    options.assertCurrent();
    if (provider.doc !== doc || !provider.db || provider._destroyed)
      throw new Error('The row-page cache provider changed before saving your edits.');
  };

  assertCurrent();
  const bytes = Y.encodeStateAsUpdate(doc);

  await new Promise<void>((resolve, reject) => {
    const transaction = provider.db!.transaction(['updates', 'custom'], 'readwrite');
    let failure: unknown;
    const cleanup = () => options.signal.removeEventListener('abort', abort);
    const abort = () => {
      failure = options.signal.reason ?? new Error('Row-page save was cancelled.');
      try { transaction.abort(); } catch { cleanup(); reject(failure); }
    };

    const checked = () => {
      try { assertCurrent(); } catch (error) {
        failure = error;
        transaction.abort();
      }
    };

    transaction.oncomplete = () => {
      cleanup();
      try { assertCurrent(); resolve(); } catch (error) { reject(error); }
    };

    transaction.onabort = () => {
      cleanup();
      reject(failure ?? transaction.error ?? new Error('The row-page checkpoint was not persisted.'));
    };

    options.signal.addEventListener('abort', abort, { once: true });
    transaction.objectStore('updates').add(bytes).onsuccess = checked;
    transaction.objectStore('custom').put(stagingJson, `${doc.guid}/first-body-stage`).onsuccess = checked;
    if (options.signal.aborted) abort();
  });
  assertCurrent();
}
