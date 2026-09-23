import * as Y from 'yjs';

import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap, metaIdMapFromRowIdMap } from '@/application/database-yjs/row_meta';
import { bindSyncStatus } from '@/application/sync-status/bind';
import {
  changeSyncCounts,
  getSyncStatus,
  markSyncDiscovered,
  markSyncReady,
  resetSyncStatus,
  setSyncAlias,
  setSyncConnected,
  setSyncParent,
  subscribeSyncStatus,
  syncAncestors,
} from '@/application/sync-status/store';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

beforeEach(() => resetSyncStatus());

function ready(...ids: string[]) {
  setSyncConnected(true);
  markSyncDiscovered();
  ids.forEach(markSyncReady);
}

it('requires connection, backlog discovery, and the page handshake before showing synced', () => {
  expect(getSyncStatus('page')).toBe('offline');
  setSyncConnected(true);
  expect(getSyncStatus('page')).toBe('checking');
  markSyncReady('page');
  expect(getSyncStatus('page')).toBe('checking');
  markSyncDiscovered();
  expect(getSyncStatus('page')).toBe('synced');
  expect(getSyncStatus('unopened')).toBe('checking');
  changeSyncCounts('page', 1, 0);
  expect(getSyncStatus('page')).toBe('syncing');
  changeSyncCounts('page', 0, 1);
  expect(getSyncStatus('page')).toBe('synced');
  changeSyncCounts('page', 1, 0, 1);
  setSyncConnected(false);
  expect(getSyncStatus('page')).toBe('error');
  changeSyncCounts('page', -1, 0, -1);
  expect(getSyncStatus('page')).toBe('offline');
  setSyncConnected(true);
  changeSyncCounts('page', -1, -1);
  expect(getSyncStatus('page')).toBe('synced');
});

it('aggregates every row and row document and transfers pending work on parent changes', () => {
  ready('old-db', 'new-db', 'row', 'other-row');
  setSyncParent('row', 'old-db');
  setSyncParent('document', 'row');
  changeSyncCounts('document', 1, 1, 1);
  expect(syncAncestors('document')).toEqual(['row', 'old-db']);
  expect(getSyncStatus('old-db')).toBe('error');
  setSyncParent('row', 'new-db');
  expect(getSyncStatus('old-db')).toBe('synced');
  expect(getSyncStatus('new-db')).toBe('error');
  changeSyncCounts('document', 0, 0, -1);
  expect(getSyncStatus('new-db')).toBe('synced');
  setSyncParent('other-row', 'new-db');
  changeSyncCounts('other-row', 1, 0);
  expect(getSyncStatus('new-db')).toBe('syncing');
  changeSyncCounts('document', -1, -1);
  expect(getSyncStatus('new-db')).toBe('syncing');
  changeSyncCounts('other-row', -1, 0);
  expect(getSyncStatus('new-db')).toBe('synced');
  expect(syncAncestors('unopened')).toEqual([]);
});

it('keeps startup checks until backlog discovery and the page handshake even with cached acceptance', () => {
  setSyncConnected(true);
  changeSyncCounts('page', 1, 1);
  expect(getSyncStatus('page')).toBe('checking');
  markSyncDiscovered();
  expect(getSyncStatus('page')).toBe('checking');
  markSyncReady('page');
  expect(getSyncStatus('page')).toBe('synced');
  changeSyncCounts('page', 0, -1);
  expect(getSyncStatus('page')).toBe('syncing');
  changeSyncCounts('page', 0, 1);
  expect(getSyncStatus('page')).toBe('synced');
  changeSyncCounts('page', -1, -1);
  expect(getSyncStatus('page')).toBe('synced');
});

it('rejects empty, self, and cyclic parents and coalesces notifications', async () => {
  await Promise.resolve();
  const listener = jest.fn();
  const unsubscribe = subscribeSyncStatus(listener);

  setSyncParent('row', 'database');
  setSyncParent('database', 'workspace');
  setSyncParent('workspace', 'row');
  setSyncParent('row', 'row');
  setSyncParent('row', '');
  setSyncParent('row', 'database');
  expect(syncAncestors('row')).toEqual(['database', 'workspace']);
  setSyncAlias('view', 'database');
  markSyncReady('database');
  setSyncConnected(true);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  setSyncAlias('view', 'database');
  markSyncReady('database');
  setSyncConnected(true);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  changeSyncCounts('', 0, 0);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
});

it('clears aliases, counts, readiness, and parent relations between sessions', () => {
  ready('database');
  setSyncAlias('view', 'database');
  setSyncParent('row', 'database');
  changeSyncCounts('row', 1, 1);
  expect(getSyncStatus('view')).toBe('synced');
  resetSyncStatus();
  ready('database');
  expect(getSyncStatus('database')).toBe('synced');
  expect(getSyncStatus('view')).toBe('checking');
  expect(syncAncestors('row')).toEqual([]);
  setSyncParent('row', 'previous-empty');
  setSyncParent('row', 'database');
  expect(syncAncestors('row')).toEqual(['database']);
});

it('binds database view aliases and row document ancestors from already open Yjs maps', () => {
  const database = new Y.Doc({ guid: 'database' }) as YDoc & { view_id: string };

  database.view_id = 'database-view';
  ready(database.guid);
  bindSyncStatus(database, Types.Database);
  expect(getSyncStatus('database-view')).toBe('synced');
  const row = new Y.Doc({ guid: '11111111-1111-4111-8111-111111111111' }) as YDoc;
  const data = row.getMap(YjsEditorKey.data_section);
  const rowData = new Y.Map();

  data.set(YjsEditorKey.database_row, rowData);
  rowData.set(YjsDatabaseKey.database_id, database.guid);
  bindSyncStatus(row, Types.DatabaseRow);
  const document = getMetaIdMap(row.guid).get(RowMetaKey.DocumentId)!;

  expect(syncAncestors(document)).toEqual([row.guid, database.guid]);
  changeSyncCounts(document, 1, 0);
  expect(getSyncStatus('database-view')).toBe('syncing');
  database.destroy();
  row.destroy();
});

it('tolerates incomplete row metadata while it is loading', () => {
  const row = new Y.Doc({ guid: '22222222-2222-4222-8222-222222222222' }) as YDoc;

  metaIdMapFromRowIdMap.set(row.guid, new Map());
  bindSyncStatus(row, Types.DatabaseRow);
  expect(syncAncestors(row.guid)).toEqual([]);
  const rowData = new Y.Map();

  row.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, rowData);
  rowData.set(YjsDatabaseKey.database_id, 1);
  bindSyncStatus(row, Types.DatabaseRow);
  expect(syncAncestors(row.guid)).toEqual([]);
  metaIdMapFromRowIdMap.delete(row.guid);
  row.destroy();
});
