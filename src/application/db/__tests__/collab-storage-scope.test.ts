import * as Y from 'yjs';

import { captureCollabStorageScope, collabStorageKey, setCollabStorageWorkspace,
  bindCollabStorageScope, assertCollabStorageCurrent, ScopedCollabMap } from '../collab-storage-scope';
import { publishDatabaseCacheEpoch, readDatabaseCacheEpoch, isDatabaseStorageFenceCurrent } from '../database-storage-fence';

let mockServer = 'https://server-a.example';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));

function select(userId = 'actor-a', workspaceId = 'workspace-a') {
  localStorage.setItem('token', JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_at: 100,
    user: { id: userId } }));
  setCollabStorageWorkspace({ serverUrl: mockServer, userId, workspaceId });
}

beforeEach(() => { localStorage.clear(); mockServer = 'https://server-a.example'; select(); });
afterEach(() => { localStorage.clear(); setCollabStorageWorkspace(null); });

it.each(['server', 'account', 'workspace'])('separates durable, memory and restore state when %s changes', (change) => {
  const scope = captureCollabStorageScope();
  const cache = new ScopedCollabMap<string>();

  cache.set('same-id', 'private edit');
  publishDatabaseCacheEpoch('same-id', 'restore-a');
  if (change === 'server') { mockServer = 'https://server-b.example'; select(); }

  if (change === 'account') select('actor-b');
  if (change === 'workspace') select('actor-a', 'workspace-b');

  expect(scope.isCurrent()).toBe(false);
  expect(collabStorageKey('same-id')).not.toBe(scope.storageKey('same-id'));
  expect(cache.get('same-id')).toBeUndefined();
  expect(readDatabaseCacheEpoch('same-id')).toBeNull();
  expect(isDatabaseStorageFenceCurrent({ databaseId: 'same-id', epoch: null, cacheEpoch: null,
    scopeKey: scope.key, scopeGeneration: scope.generation })).toBe(false);
});

it('retains stable durable identity but fences old work after leaving and returning', () => {
  const first = captureCollabStorageScope();
  const cache = new ScopedCollabMap<string>();
  const capturedMap = cache.capture();
  const doc = new Y.Doc();

  bindCollabStorageScope(doc, first);
  select('actor-b');
  select();
  capturedMap.set('same-id', 'late result');
  expect(collabStorageKey('same-id')).toBe(first.storageKey('same-id'));
  expect(first.isCurrent()).toBe(false);
  expect(() => assertCollabStorageCurrent(doc)).toThrow('context changed');
  expect(cache.get('same-id')).toBeUndefined();
  doc.destroy();
});

it('keeps same-actor token refresh valid and rejects token replacement before React remounts', () => {
  const scope = captureCollabStorageScope();

  localStorage.setItem('token', JSON.stringify({ access_token: 'refreshed', refresh_token: 'refresh', expires_at: 200,
    user: { id: 'actor-a' } }));
  expect(scope.isCurrent()).toBe(true);
  localStorage.setItem('token', JSON.stringify({ access_token: 'other', refresh_token: 'refresh', expires_at: 200,
    user: { id: 'actor-b' } }));
  expect(scope.isCurrent()).toBe(false);
  // The old active workspace is not borrowed by a new account.
  expect(captureCollabStorageScope().key).toBe(JSON.stringify([mockServer, 'actor-b', null]));
});
