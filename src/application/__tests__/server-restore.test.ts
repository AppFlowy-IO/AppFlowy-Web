import { INITIAL_SERVER_RESTORE_ID, restoreCacheKey, ServerRestoreBoundary, splitRestoreCacheKey } from '../server-restore';

const restoredId = '11111111-1111-4111-8111-111111111111';
const nextRestoreId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => localStorage.clear());

test('ordinary reconnects and legacy discovery retain offline edits and cache identity', () => {
  const reload = jest.fn();
  const tab = new ServerRestoreBoundary('https://cloud', localStorage, reload);

  tab.accept(undefined);
  tab.accept(INITIAL_SERVER_RESTORE_ID);
  tab.accept(INITIAL_SERVER_RESTORE_ID);
  expect(tab.cacheKey('document')).toBe('document');
  expect(reload).not.toHaveBeenCalled();
  expect(() => tab.assertCurrent()).not.toThrow();
});

test('all old tabs retire and retain their old namespace while a new tab uses fresh caches', () => {
  const reloadLeader = jest.fn();
  const reloadFollower = jest.fn();
  const leader = new ServerRestoreBoundary('https://cloud', localStorage, reloadLeader);
  const follower = new ServerRestoreBoundary('https://cloud', localStorage, reloadFollower);

  expect(() => leader.accept(restoredId)).toThrow('reloading');
  expect(() => follower.assertCurrent()).toThrow('reloading');
  const reopened = new ServerRestoreBoundary('https://cloud', localStorage, jest.fn());

  reopened.accept(restoredId);
  for (const key of ['document', 'af_database_cache', 'af_database_blob_rid:db', 'workspace:ws']) {
    expect(leader.cacheKey(key)).toBe(follower.cacheKey(key));
    expect(reopened.cacheKey(key)).not.toBe(leader.cacheKey(key));
  }

  // A delayed result from an old tab cannot republish the old generation.
  expect(() => follower.accept(INITIAL_SERVER_RESTORE_ID)).toThrow('reloading');
  expect(localStorage.getItem(reopened.storageKey)).toBe(restoredId);
  expect(reloadLeader).toHaveBeenCalledTimes(1);
  expect(reloadFollower).toHaveBeenCalledTimes(1);
});

test('subsequent restores rotate again, ordinary reloads retain the committed namespace', () => {
  const original = new ServerRestoreBoundary('https://cloud', localStorage, jest.fn());

  expect(() => original.accept(restoredId)).toThrow();
  const tab = new ServerRestoreBoundary('https://cloud/', localStorage, jest.fn());

  tab.accept(restoredId);
  expect(tab.restoreId).toBe(restoredId);
  expect(tab.logicalCacheKey('document')).toBeUndefined();
  expect(tab.logicalCacheKey(tab.cacheKey('document'))).toBe('document');
  expect(() => tab.accept(nextRestoreId)).toThrow();
  const nextTab = new ServerRestoreBoundary('https://cloud', localStorage, jest.fn());

  expect(nextTab.logicalCacheKey(tab.cacheKey('document'))).toBeUndefined();
  expect(nextTab.cacheKey('document')).not.toBe(tab.cacheKey('document'));
  expect(new ServerRestoreBoundary('https://another-server', localStorage, jest.fn()).restoreId)
    .toBe(INITIAL_SERVER_RESTORE_ID);
});

test('denied persistence or malformed discovery never allows a restored connection', () => {
  const reload = jest.fn();
  const denied = new ServerRestoreBoundary('https://cloud', {
    getItem: () => null,
    setItem: () => { throw new Error('Storage denied'); },
  }, reload);

  expect(() => denied.accept(restoredId)).toThrow('Storage denied');
  for (const invalid of [null, '', 'unknown', 42]) expect(() => denied.accept(invalid)).toThrow('Invalid');
  expect(reload).not.toHaveBeenCalled();
});

test('a stored name splits into the restore generation that wrote it and its logical name', () => {
  expect(splitRestoreCacheKey('document')).toEqual({ restoreId: INITIAL_SERVER_RESTORE_ID, logicalName: 'document' });
  expect(splitRestoreCacheKey(`server-restore:${restoredId}:workspace:ws`)).toEqual({
    restoreId: restoredId,
    logicalName: 'workspace:ws',
  });
  // Only a well-formed generation prefix names a generation.
  expect(splitRestoreCacheKey('server-restore:not-a-restore:document').restoreId).toBe(INITIAL_SERVER_RESTORE_ID);
  for (const restoreId of [INITIAL_SERVER_RESTORE_ID, restoredId, nextRestoreId]) {
    const tab = new ServerRestoreBoundary('https://cloud', { getItem: () => restoreId, setItem: jest.fn() }, jest.fn());

    expect(restoreCacheKey(restoreId, 'af_database_cache')).toBe(tab.cacheKey('af_database_cache'));
    expect(splitRestoreCacheKey(tab.cacheKey('af_database_cache'))).toEqual({ restoreId, logicalName: 'af_database_cache' });
  }
});
