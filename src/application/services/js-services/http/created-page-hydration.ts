import * as Y from 'yjs';

import { atomicRead, AtomicCreationOwner } from '@/application/atomic-creation';
import { captureDatabaseStorageFence, getCachedProviderDoc, openCollabDBWithProvider, openRowCollabDBWithProvider, publishWithDatabaseStorageFence } from '@/application/db';
import { DatabaseStorageFence, isDatabaseStorageFenceCurrent, withDatabaseStorageFence } from '@/application/db/database-storage-fence';
import { getCachedRowDoc } from '@/application/services/js-services/cache';
import { CreatePageResponse, Types, View, ViewLayout, YDoc, YjsEditorKey } from '@/application/types';
import { rememberCreatedDocument } from '@/application/view-loader/created-document';
import { applyYDoc } from '@/application/ydoc/apply';

import { collabFullSyncBatch, CollabFullSyncBatchResult } from './collab-api';

import type { prepareDefaultPage } from './page-default-creation';

const ORIGINAL_RESTORE = '00000000-0000-0000-0000-000000000000';
const FOLDER_LAYOUTS = [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar, ViewLayout.Chart,
  ViewLayout.List, ViewLayout.Gallery, ViewLayout.Feed, ViewLayout.Form, ViewLayout.Timeline];

type PreparedPage = ReturnType<typeof prepareDefaultPage>;
interface RestoreState { database_restore_id: string | null; version: string | null }

function requireMap(value: unknown): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) throw new Error('Created content schema is incomplete');
  return value;
}

function decode(result: CollabFullSyncBatchResult, objectId: string, type: Types): YDoc {
  if (result.error || result.objectId !== objectId || result.collabType !== type || !result.missingUpdate.length) {
    throw new Error('Created content identity or permission changed');
  }

  const doc = new Y.Doc({ guid: objectId }) as YDoc;

  try {
    Y.applyUpdate(doc, result.missingUpdate);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Created content history is incomplete');
    const actual = Y.decodeStateVector(Y.encodeStateVector(doc));
    const reported = Y.decodeStateVector(result.serverStateVector);

    if (actual.size !== reported.size || [...reported].some(([client, clock]) => actual.get(client) !== clock)) {
      throw new Error('Created content history is incomplete');
    }

    doc.version = result.collabVersion;
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

function validateDocument(doc: Y.Doc): string {
  const document = requireMap(doc.getMap('data').get('document'));
  const blocks = requireMap(document.get('blocks'));
  const metadata = requireMap(document.get('meta'));
  const children = requireMap(metadata.get('children_map'));
  const texts = requireMap(metadata.get('text_map'));
  const rootId = document.get('page_id');

  // The server owns the root block ID. It deliberately differs from the collab ID.
  if (typeof rootId !== 'string' || requireMap(blocks.get(rootId)).get('ty') !== 'page') {
    throw new Error('Created Document root is incomplete');
  }

  const visited = new Set<string>();
  const pending = [{ id: rootId, parent: '' }];

  while (pending.length) {
    const { id, parent } = pending.pop()!;
    const block = requireMap(blocks.get(id));

    if (visited.has(id) || block.get('id') !== id || block.get('parent') !== parent) {
      throw new Error('Created Document tree is incomplete');
    }

    visited.add(id);
    if (block.get('external_type') === 'text' && !(texts.get(String(block.get('external_id'))) instanceof Y.Text)) {
      throw new Error('Created Document text is incomplete');
    }

    const list = children.get(String(block.get('children')));

    if (!(list instanceof Y.Array)) throw new Error('Created Document children are incomplete');
    for (const child of list.toArray()) {
      if (typeof child !== 'string') throw new Error('Created Document child identity is invalid');
      pending.push({ id: child, parent: id });
    }
  }

  return rootId;
}

function validateDatabase(doc: Y.Doc, folder: View, prepared: Extract<PreparedPage, { kind: 'database' }>): string[] {
  const database = requireMap(doc.getMap('data').get('database'));
  const expected = prepared.request.database;

  if (database.get('id') !== expected.database_id || folder.extra?.database_id !== expected.database_id || !folder.extra.is_database_container) {
    throw new Error('Created database and folder identities differ');
  }

  const fields = requireMap(database.get('fields'));
  const views = requireMap(database.get('views'));

  if (![...fields.values()].some((field) => requireMap(field).get('is_primary') === true)) {
    throw new Error('Created Database primary field is missing');
  }

  for (const viewId of [expected.view_id, ...(expected.responses_view_id ? [expected.responses_view_id] : [])]) {
    const view = requireMap(views.get(viewId));
    const child = folder.children.find((item) => item.view_id === viewId);
    const layout = view.get('layout');

    if (!child || child.extra?.database_id !== expected.database_id || view.get('id') !== viewId ||
      view.get('database_id') !== expected.database_id || (typeof layout !== 'number' && typeof layout !== 'bigint') ||
      FOLDER_LAYOUTS[Number(layout)] !== child.layout) {
      throw new Error('Created database view is missing from its content or folder');
    }
  }

  const inlineId = requireMap(database.get('metas')).get('iid');
  const inline = requireMap(views.get(String(inlineId)));
  const orders = inline.get('row_orders');

  if (inline.get('id') !== inlineId || inline.get('database_id') !== expected.database_id || !(orders instanceof Y.Array)) {
    throw new Error('Created Database canonical row membership is missing');
  }

  const active = new Set<string>();

  for (const order of orders.toArray()) {
    const value = order instanceof Y.Map ? order.toJSON() : order;

    if (!value || typeof value.id !== 'string' || (value.is_deleted !== null && value.is_deleted !== undefined && typeof value.is_deleted !== 'boolean')) {
      throw new Error('Created Database canonical row membership is invalid');
    }

    if (value.is_deleted !== true) active.add(value.id);
  }

  return [...active];
}

function validateRow(doc: Y.Doc, rowId: string, databaseId: string): void {
  const body = requireMap(doc.getMap('data').get('data'));

  if (body.get('id') !== rowId || body.get('database_id') !== databaseId) {
    throw new Error('Created database row has a different owner');
  }

  requireMap(body.get('cells'));
  requireMap(doc.getMap('data').get('meta'));
}

/** Authoritative current bytes reach the same providers that the editor will open. */
export async function verifyCreatedPage(owner: AtomicCreationOwner, prepared: PreparedPage): Promise<CreatePageResponse> {
  const isDatabase = prepared.kind === 'database';
  const folderId = isDatabase ? prepared.request.container_id : prepared.request.view_id;
  const objectId = isDatabase ? prepared.request.database.database_id : folderId;
  const type = isDatabase ? Types.Database : Types.Document;
  const temporary: Y.Doc[] = [];
  const controller = new AbortController();
  const deadline = Date.now() + 30_000;
  const timeout = setTimeout(() => controller.abort(new Error('Created page hydration expired')), 30_000);
  let fence: DatabaseStorageFence | undefined;
  let restore: RestoreState | undefined;
  const assertCurrent = () => {
    owner.assertCurrent();
    if (controller.signal.aborted) throw controller.signal.reason;
    if (fence && !isDatabaseStorageFenceCurrent(fence)) throw new Error('Created Database storage changed');
  };

  const readRestore = () => atomicRead<RestoreState>(owner,
    `/api/workspace/${owner.workspaceId}/database/${objectId}/restore-state`, undefined, controller.signal);
  const read = async (ids: string[], collabType: Types) => {
    if (!ids.length) return [];
    const results = await collabFullSyncBatch(owner.workspaceId, ids.map((id) => ({ objectId: id, collabType,
      stateVector: new Uint8Array([0]), docState: new Uint8Array(),
      ...(restore ? { databaseRestoreId: restore.database_restore_id ?? ORIGINAL_RESTORE } : {}),
    })), { atomicCreationOwner: owner, signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) });

    assertCurrent();
    if (results.length !== ids.length || new Set(results.map((result) => result.objectId)).size !== ids.length) {
      throw new Error('Created content response is ambiguous');
    }

    return ids.map((id) => {
      const result = results.find((candidate) => candidate.objectId === id);

      if (!result) throw new Error('Created content is missing');
      const doc = decode(result, id, collabType);

      temporary.push(doc);
      return doc;
    });
  };

  try {
    if (isDatabase) {
      fence = await captureDatabaseStorageFence(objectId, { required: true });
      assertCurrent();
    }

    const folderRead = atomicRead<View>(owner, `/api/workspace/${owner.workspaceId}/view/${folderId}`, { depth: 1 }, controller.signal);
    const contentRead = (async () => {
      if (isDatabase) {
        restore = await readRestore();
        const restoreId = restore.database_restore_id ?? ORIGINAL_RESTORE;

        if ((fence!.epoch ?? ORIGINAL_RESTORE) !== restoreId || (fence!.cacheEpoch ?? ORIGINAL_RESTORE) !== restoreId) {
          throw new Error('Reopen the created Database after its restore completes');
        }
      }

      return (await read([objectId], type))[0];
    })();
    const [folder, remote] = await Promise.all([folderRead, contentRead]);

    assertCurrent();
    if (folder.view_id !== folderId) throw new Error('Created page returned a different identity');
    const activeRows = prepared.kind === 'database' ? validateDatabase(remote, folder, prepared) : [];
    const documentRoot = isDatabase ? undefined : validateDocument(remote);

    if (restore && (restore.version ?? undefined) !== remote.version) throw new Error('Created Database version changed');
    const remoteRows = await read(activeRows, Types.DatabaseRow);

    remoteRows.forEach((row) => validateRow(row, row.guid, objectId));
    const [canonical, rows] = await Promise.all([
      openCollabDBWithProvider(objectId, { awaitSync: true,
        ...(restore?.database_restore_id ? { databaseRestoreId: restore.database_restore_id } : {}),
      }),
      Promise.all(activeRows.map((id) => openRowCollabDBWithProvider(id, { awaitSync: true }))),
    ]);
    const entries = [{ ...canonical, remote, id: objectId }, ...rows.map((entry, index) => ({ ...entry, remote: remoteRows[index], id: activeRows[index] }))];
    let retired = false;
    const onDestroy = () => { retired = true; };

    entries.forEach(({ doc }) => doc.on('destroy', onDestroy));
    try {
      const validateMerge = () => {
        assertCurrent();
        if (retired) throw new Error('Created page provider retired');
        for (const [index, entry] of entries.entries()) {
          const { doc, remote: current } = entry;
          const cached = index ? getCachedRowDoc(entry.id) : undefined;

          if (getCachedProviderDoc(entry.id) !== doc) throw new Error('Created page provider retired');
          if (cached && cached !== doc) throw new Error('Created Row cache provider changed');
          if ((doc.version !== undefined || doc.getMap(YjsEditorKey.data_section).size) && doc.version !== current.version) throw new Error('Created page cache version differs');
          const merged = new Y.Doc();

          try {
            Y.applyUpdate(merged, Y.encodeStateAsUpdate(doc));
            Y.applyUpdate(merged, Y.encodeStateAsUpdate(current));
            if (index) validateRow(merged, entry.id, objectId);
            else if (prepared.kind === 'database') validateDatabase(merged, folder, prepared);
            else if (validateDocument(merged) !== documentRoot) throw new Error('Created Document cache root differs');
          } finally { merged.destroy(); }
        }
      };

      validateMerge();
      if (isDatabase) {
        const after = await readRestore();

        if (after.database_restore_id !== restore!.database_restore_id || after.version !== restore!.version) {
          throw new Error('Created Database restore changed during hydration');
        }
      }

      // Root metadata stays in its restore-specific IndexedDB namespace. Row providers
      // reject writes after their own durable epoch retires; neither path resets edits.
      await Promise.all(entries.filter((entry) => entry.remote.version !== undefined).map(async (entry) => {
        assertCurrent();
        await entry.provider.set(`${entry.id}/version`, entry.remote.version!);
        assertCurrent();
      }));
      const publish = () => {
        validateMerge();
        for (const entry of entries) {
          entry.doc.version = entry.remote.version;
          if (restore) entry.doc.databaseRestoreId = restore.database_restore_id ?? undefined;
          withDatabaseStorageFence(entry.doc, fence, () => applyYDoc(entry.doc, Y.encodeStateAsUpdate(entry.remote)));
        }
      };

      if (fence) {
        if (!(await publishWithDatabaseStorageFence(fence, publish))) throw new Error('Created Database storage changed before activation');
      } else publish();
      assertCurrent();
      if (!isDatabase) rememberCreatedDocument(canonical.doc, owner, folderId);
      return isDatabase ? { view_id: prepared.selectedViewId, database_id: objectId } : { view_id: folderId };
    } finally { entries.forEach(({ doc }) => doc.off('destroy', onDestroy)); }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    temporary.forEach((doc) => doc.destroy());
  }
}
