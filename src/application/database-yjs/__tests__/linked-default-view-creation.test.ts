import * as Y from 'yjs';

import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { createLinkedDefaultDatabaseView, LinkedDefaultViewIntent } from '@/application/database-yjs/creation/create-linked-default-view';
import { DatabaseViewLayout, YDoc } from '@/application/types';

jest.mock('@/application/atomic-creation', () => ({
  captureAtomicCreationOwner: (_workspace: string, assertCurrent?: () => void) => ({ assertCurrent: () => assertCurrent?.() }),
}));
jest.mock('@/application/database-yjs/creation/create-default-view', () => ({ createDefaultDatabaseView: jest.fn() }));

function fixture() {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  doc.getMap('data').set('authored-source', 'preserved');
  const sync = { flush: jest.fn(), sync: jest.fn() };
  const intent: LinkedDefaultViewIntent = {
    workspaceId: 'workspace', requestViewId: 'document', sourceViewId: 'source', layout: DatabaseViewLayout.Grid,
    payload: { database_id: 'db', parent_view_id: 'document', name: 'Linked', embedded: true },
    loadView: jest.fn(async () => doc), bindViewSync: jest.fn(() => sync as never),
    scheduleDeferredCleanup: jest.fn(), activate: jest.fn(async () => undefined),
  };
  return { doc, sync, intent };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
    intent.assertCurrent?.();
    await intent.activate?.('created');
    return 'created';
  });
});

it.each([DatabaseViewLayout.Grid, DatabaseViewLayout.Board, DatabaseViewLayout.Calendar,
  DatabaseViewLayout.Chart, DatabaseViewLayout.List, DatabaseViewLayout.Gallery, DatabaseViewLayout.Feed,
  DatabaseViewLayout.Form, DatabaseViewLayout.Timeline])('clones layout %s through the compact coordinator and releases only its borrowed owner', async (layout) => {
  const { doc, sync, intent } = fixture();
  const before = Y.encodeStateAsUpdate(doc);
  await expect(createLinkedDefaultDatabaseView({ ...intent, layout })).resolves.toEqual({ view_id: 'created', database_id: 'db' });
  expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({
    databaseDoc: doc, sourceViewId: 'source', databaseId: 'db', parentViewId: 'document', layout, embedded: true,
  }));
  expect(intent.activate).toHaveBeenCalledWith('created');
  expect(intent.scheduleDeferredCleanup).toHaveBeenCalledWith('db');
  expect(sync.flush).not.toHaveBeenCalled();
  expect(sync.sync).not.toHaveBeenCalled();
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  doc.destroy();
});

it.each(['loadView', 'bindViewSync', 'scheduleDeferredCleanup'] as const)('refuses missing %s before borrowing or submitting', async (key) => {
  const { doc, intent } = fixture();
  await expect(createLinkedDefaultDatabaseView({ ...intent, [key]: undefined })).rejects.toThrow('not available');
  expect(intent.loadView).not.toHaveBeenCalled();
  expect(createDefaultDatabaseView).not.toHaveBeenCalled();
  doc.destroy();
});

it('releases the borrowed document when sync binding fails without submitting', async () => {
  const { doc, intent } = fixture();
  intent.bindViewSync = jest.fn(() => null);
  await expect(createLinkedDefaultDatabaseView(intent)).rejects.toThrow('no live sync owner');
  expect(createDefaultDatabaseView).not.toHaveBeenCalled();
  expect(intent.scheduleDeferredCleanup).toHaveBeenCalledWith('db');
  doc.destroy();
});

it('does not submit after ownership changes during source loading', async () => {
  const { doc, intent } = fixture();
  let current = true;
  intent.assertCurrent = () => { if (!current) throw new Error('retired'); };
  intent.loadView = jest.fn(async () => { current = false; return doc; });
  await expect(createLinkedDefaultDatabaseView(intent)).rejects.toThrow('retired');
  expect(createDefaultDatabaseView).not.toHaveBeenCalled();
  expect(intent.scheduleDeferredCleanup).toHaveBeenCalledWith('db');
  doc.destroy();
});

it('preserves the original creation error and leaves authored source bytes intact', async () => {
  const { doc, intent } = fixture();
  const before = Y.encodeStateAsUpdate(doc);
  const error = new Error('publication pending');
  jest.mocked(createDefaultDatabaseView).mockRejectedValue(error);
  await expect(createLinkedDefaultDatabaseView(intent)).rejects.toBe(error);
  expect(intent.activate).not.toHaveBeenCalled();
  expect(intent.scheduleDeferredCleanup).toHaveBeenCalledWith('db');
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  doc.destroy();
});
