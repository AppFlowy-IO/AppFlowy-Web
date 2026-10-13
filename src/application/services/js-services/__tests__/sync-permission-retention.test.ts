import * as Y from 'yjs';

import { deleteCollabDB } from '@/application/db';
import { bindCollabStorageScope, captureCollabStorageScope, setCollabStorageWorkspace } from '@/application/db/collab-storage-scope';
import { blockPermissionSync, deleteOutboxByObjectId, enqueueOutboxUpdate } from '@/application/sync-outbox';
import { Types } from '@/application/types';

import { handleMessage, initSync, SyncContext } from '../sync-protocol';

jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn(async () => true) }));
jest.mock('@/application/session/token-storage', () => ({ getTokenParsed: () => ({ user: { id: 'actor' } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server' }));
jest.mock('@/application/sync-outbox', () => ({
  getCurrentOutboxSession: () => ({ userId: 'actor', serverUrl: 'https://server', workspaceId: 'workspace' }),
  blockPermissionSync: jest.fn(async () => undefined),
  deleteOutboxByObjectId: jest.fn(async () => undefined),
  enqueueOutboxUpdate: jest.fn(async () => true),
  shouldRouteUpdateThroughOutbox: () => true,
  waitForDrain: jest.fn(async () => true),
}));

beforeEach(() => { jest.clearAllMocks(); setCollabStorageWorkspace({ userId: 'actor', serverUrl: 'https://server', workspaceId: 'workspace' }); });

function context(): SyncContext {
  const doc = new Y.Doc({ guid: 'document' });

  bindCollabStorageScope(doc, captureCollabStorageScope());
  const ctx = { doc, collabType: Types.Document, emit: jest.fn() };

  jest.spyOn(doc, 'destroy');
  initSync(ctx);
  return ctx;
}

test('socket read revocation quarantines unsent edits and removes only the synced copy', () => {
  const ctx = context();

  ctx.doc.getText('body').insert(0, 'Retained offline edit');
  expect(enqueueOutboxUpdate).toHaveBeenCalledTimes(1);
  handleMessage(ctx, { objectId: ctx.doc.guid, accessChanged: { canRead: false, canWrite: false } });
  expect(blockPermissionSync).toHaveBeenCalledWith('document', 'workspace');
  expect(deleteCollabDB).toHaveBeenCalledWith('document', { destroyDoc: false });
  expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
  expect(ctx.doc.destroy).toHaveBeenCalledTimes(1);
  expect(ctx.flush).toBeUndefined();
});

test('socket Edit to View blocks writes while preserving the readable document', () => {
  const ctx = context();

  handleMessage(ctx, { objectId: ctx.doc.guid, accessChanged: { canRead: true, canWrite: false } });
  expect(blockPermissionSync).toHaveBeenCalledWith('document', 'workspace');
  expect(deleteCollabDB).not.toHaveBeenCalled();
  expect(ctx.doc.destroy).not.toHaveBeenCalled();
  ctx.doc.destroy();
  expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
});

test('ordinary destruction preserves edits while an explicit version discard still deletes them', async () => {
  const ctx = context();

  ctx.doc.destroy();
  expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
  await ctx.discardPendingUpdates?.({ skipActiveDrain: true });
  expect(deleteOutboxByObjectId).toHaveBeenCalledWith('document', { skipActiveDrain: true });
});

test('a delayed revocation cannot close the replacement workspace document', () => {
  const ctx = context();

  setCollabStorageWorkspace({ userId: 'actor', serverUrl: 'https://server', workspaceId: 'another-workspace' });
  handleMessage(ctx, { objectId: ctx.doc.guid, accessChanged: { canRead: false, canWrite: false } });
  expect(blockPermissionSync).not.toHaveBeenCalled();
  expect(deleteCollabDB).not.toHaveBeenCalled();
  expect(ctx.doc.destroy).not.toHaveBeenCalled();
  ctx.doc.destroy();
});
