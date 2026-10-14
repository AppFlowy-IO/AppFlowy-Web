import * as Y from 'yjs';

import { assertNotAborted } from '@/application/database-yjs/creation/source-readiness';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { parseDatabaseRowTemplate } from '@/application/database-yjs/template/codec';
import { readTemplateRecords } from '@/application/database-yjs/template/storage';
import { YDoc, YjsEditorKey } from '@/application/types';

export interface CollabState {
  object_id: string;
  doc_state: number[];
  version: number;
  collab_version?: string | null;
}

export function decodeCurrentRowPageCollab(state: CollabState, objectId: string, version?: string | null): YDoc {
  if (
    state.object_id !== objectId ||
    !Array.isArray(state.doc_state) ||
    state.doc_state.length === 0 ||
    state.doc_state.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
    (version !== undefined && (state.collab_version ?? null) !== version)
  )
    throw new Error('The current row-page identity or version changed.');
  const doc = new Y.Doc({ guid: objectId }) as YDoc;

  try {
    if (state.version === 0) Y.applyUpdate(doc, new Uint8Array(state.doc_state));
    else if (state.version === 1) Y.applyUpdateV2(doc, new Uint8Array(state.doc_state));
    else throw new Error('Unsupported row-page encoding.');
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('The current row-page history is incomplete.');
    doc.version = state.collab_version ?? undefined;
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

export interface RowDocumentSourceIdentity {
  databaseId: string;
  sourceViewId: string;
  rowId: string;
  databaseVersion?: string;
  rowVersion?: string;
}

/** Hidden template rows are owned by the current registry, never by a UI flag. */
export function hasCurrentRowDocumentSource(database: Y.Map<unknown>, viewId: string, rowId: string): boolean {
  const views = database.get('views');
  const view = views instanceof Y.Map ? views.get(viewId) : undefined;
  const orders = view instanceof Y.Map ? view.get('row_orders') : undefined;

  if (!(orders instanceof Y.Array)) return false;
  if (orders.toArray().some((entry: unknown) => {
    if (entry instanceof Y.Map) return entry.get('id') === rowId && entry.get('is_deleted') !== true;
    const order = entry as { id?: string; is_deleted?: boolean } | null;

    return order?.id === rowId && order.is_deleted !== true;
  })) return true;

  const metas = database.get('metas');
  const documentId = getMetaIdMap(rowId).get(RowMetaKey.DocumentId);

  return metas instanceof Y.Map && readTemplateRecords(metas).some((record) => {
    const template = parseDatabaseRowTemplate(record);

    return template?.templateId === rowId && template.docViewId === documentId;
  });
}

/** Existing Add Row sync remains the producer; this boundary only observes its result. */
export async function waitForRowDocumentSource(
  identity: RowDocumentSourceIdentity,
  options: {
    read: (signal: AbortSignal) => Promise<{ database: CollabState; row?: CollabState }>;
    assertCurrent: () => void;
    signal: AbortSignal;
    deadline: number;
  }
): Promise<CollabState> {
  while (!options.signal.aborted) {
    assertNotAborted(options.signal);
    options.assertCurrent();
    if (Date.now() >= options.deadline) throw new Error('The new row has not reached the server yet.');
    const state = await options.read(options.signal);

    assertNotAborted(options.signal);
    options.assertCurrent();
    if (Date.now() >= options.deadline) throw new Error('The row-page source check expired.');
    const database = decodeCurrentRowPageCollab(state.database, identity.databaseId, identity.databaseVersion ?? null);
    let row: Y.Doc | undefined;

    try {
      const root = database.getMap(YjsEditorKey.data_section).get('database');

      if (!(root instanceof Y.Map) || root.get('id') !== identity.databaseId)
        throw new Error('The current source Database identity changed.');
      const views = root.get('views');

      if (!(views instanceof Y.Map)) throw new Error('The current source Database is incomplete.');
      const view = views.get(identity.sourceViewId);
      const orders = view instanceof Y.Map ? view.get('row_orders') : undefined;

      if (view && !(orders instanceof Y.Array)) throw new Error('The current source view is incomplete.');
      const member = hasCurrentRowDocumentSource(root, identity.sourceViewId, identity.rowId);

      if (state.row) {
        row = decodeCurrentRowPageCollab(state.row, identity.rowId, identity.rowVersion ?? null);
        const data = row.getMap('data').get('data');

        if (
          !(data instanceof Y.Map) ||
          data.get('id') !== identity.rowId ||
          data.get('database_id') !== identity.databaseId
        )
          throw new Error('The current source Row identity changed.');
        // Later local cell edits need not finish syncing to publish its body.
        if (member) return state.row;
      }
    } finally {
      database.destroy();
      row?.destroy();
    }

    await new Promise<void>((resolve, reject) => {
      const done = () => {
        options.signal.removeEventListener('abort', abort);
        resolve();
      };

      const timer = setTimeout(done, Math.min(100, Math.max(0, options.deadline - Date.now())));
      const abort = () => {
        clearTimeout(timer);
        reject(options.signal.reason);
      };

      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) abort();
    });
  }

  assertNotAborted(options.signal);
  throw new Error('The row-page source check did not complete.');
}
