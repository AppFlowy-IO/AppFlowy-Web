import { DatabaseStorageGenerationChangedError } from '@/application/db/database-storage-fence';

import { DATABASE_RESTORE_CHECK_INTERVAL_MS, DatabaseRestoreTracker } from '../databaseRestoreState';

beforeEach(() => localStorage.clear());
afterEach(() => jest.useRealTimers());

test('routine traffic shares database authority for five minutes without extending its lifetime', async () => {
  jest.useFakeTimers();
  const read = jest.fn(async () => ({ database_restore_id: null, version: null }));
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);

  await Promise.all([tracker.checkIfStale('a'), tracker.checkIfStale('a'), tracker.checkIfStale('b')]);
  expect(read).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(DATABASE_RESTORE_CHECK_INTERVAL_MS - 1);
  await tracker.checkIfStale('a');
  await tracker.checkIfStale('b');
  expect(read).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(1);
  await tracker.checkIfStale('a');
  expect(read).toHaveBeenCalledTimes(3);
  expect(read).toHaveBeenLastCalledWith('a');
});

test('new restore evidence and reopening bypass freshness, but persisted markers never establish freshness', async () => {
  localStorage.setItem('marker:db', 'current');
  const read = jest.fn(async () => ({ database_restore_id: 'current', version: 'v' }));
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);

  await tracker.checkIfStale('db');
  tracker.observeRestoreHint('db', 'next');
  await tracker.checkIfStale('db');
  tracker.observeRestoreHint('db', 'next');
  await tracker.checkIfStale('db');
  expect(read).toHaveBeenCalledTimes(2);
  tracker.observeRestoreHint('db');
  await tracker.checkIfStale('db');
  tracker.invalidateVerification('db');
  await tracker.checkIfStale('db');
  expect(read).toHaveBeenCalledTimes(4);
});

test('sequential messages honor Retry-After while new restore evidence can retry immediately', async () => {
  jest.useFakeTimers();
  const busy = Object.assign(new Error('busy'), { retryAfterSecs: 7 });
  const read = jest.fn().mockRejectedValue(busy);
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);

  await expect(tracker.checkIfStale('db')).rejects.toThrow('busy');
  jest.advanceTimersByTime(6999);
  await expect(tracker.checkIfStale('db')).rejects.toThrow('busy');
  expect(read).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await expect(tracker.checkIfStale('db')).rejects.toThrow('busy');
  expect(read).toHaveBeenCalledTimes(2);
  read.mockResolvedValue({ database_restore_id: null, version: null });
  tracker.observeRestoreHint('db', 'restore');
  await tracker.checkIfStale('db');
  expect(read).toHaveBeenCalledTimes(3);
});

test.each([false, true])('root hints arriving during a read only repeat it for a new version: %s', async (changed) => {
  let finish!: (state: { database_restore_id: null; version: null }) => void;
  const read = jest.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ database_restore_id: null, version: null });
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);

  tracker.observeRestoreHint('db', undefined, 'version-a');
  const pending = tracker.checkIfStale('db');

  tracker.observeRestoreHint('db', undefined, changed ? 'version-b' : 'version-a');
  finish({ database_restore_id: null, version: null });
  await expect(pending).resolves.toBe(true);
  expect(read).toHaveBeenCalledTimes(changed ? 2 : 1);
});

test('alternating version and restore hints preserve the same failed-read cooldown', async () => {
  jest.useFakeTimers();
  const read = jest.fn().mockRejectedValue(new Error('offline'));
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);

  tracker.observeRestoreHint('db', 'restore-a', 'version-a');
  await expect(tracker.checkIfStale('db')).rejects.toThrow('offline');
  for (let i = 0; i < 10; i++) {
    tracker.observeRestoreHint('db', undefined, 'version-a');
    tracker.observeRestoreHint('db', 'restore-a');
    await expect(tracker.checkIfStale('db')).rejects.toThrow('offline');
  }

  expect(read).toHaveBeenCalledTimes(1);
  tracker.observeRestoreHint('db', undefined, 'version-b');
  await expect(tracker.checkIfStale('db')).rejects.toThrow('offline');
  expect(read).toHaveBeenCalledTimes(2);
});

test('a new restore identity resets even when the history version is unchanged', async () => {
  localStorage.setItem('marker:db', 'restore-1');
  const read = jest.fn().mockResolvedValue({ database_restore_id: 'restore-2', version: 'same-version' });
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);

  expect(await tracker.check('db')).toBe(false);
  expect(reset).toHaveBeenCalledWith('db', { database_restore_id: 'restore-2', version: 'same-version' }, false);
  expect(await tracker.check('db')).toBe(true);
  expect(reset).toHaveBeenCalledTimes(1);
});

test.each([false, true])('first restored generation is initial hydration even with a restore hint: %s', async (hasHint) => {
  const state = { database_restore_id: 'earlier-restore', version: 'version' };
  const read = jest.fn().mockResolvedValue(state);
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);

  if (hasHint) tracker.observeRestoreHint('db', state.database_restore_id);
  expect(await tracker.check('db')).toBe(false);
  expect(reset).toHaveBeenCalledWith('db', state, true);
  expect(await tracker.check('db')).toBe(true);
  expect(reset).toHaveBeenCalledTimes(1);
});

test('a verified original generation makes the first subsequent restore a live transition', async () => {
  const state = { database_restore_id: 'first-restore', version: 'version' };
  const read = jest.fn()
    .mockResolvedValueOnce({ database_restore_id: null, version: 'original' })
    .mockResolvedValue(state);
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);

  expect(await tracker.check('db')).toBe(true);
  expect(reset).not.toHaveBeenCalled();
  expect(await tracker.check('db')).toBe(false);
  expect(reset).toHaveBeenCalledWith('db', state, false);
});

test('another tab updating shared storage cannot mark this tab’s live documents current', async () => {
  localStorage.setItem('marker:db', 'restore-1');
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', async () => ({
    database_restore_id: 'restore-2', version: 'version',
  }), reset, localStorage);

  localStorage.setItem('marker:db', 'restore-2');
  await tracker.check('db');
  expect(reset).toHaveBeenCalledTimes(1);
});

test('concurrent callers share verification and failed reload never advances the marker', async () => {
  const reset = jest.fn().mockRejectedValueOnce(new Error('Cache unavailable')).mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', async () => ({
    database_restore_id: 'restore-1', version: 'version',
  }), reset, localStorage);
  const first = tracker.check('db');
  const second = tracker.check('db');

  expect(first).toBe(second);
  await expect(first).rejects.toThrow('Cache unavailable');
  expect(localStorage.getItem('marker:db')).toBeNull();
  await tracker.check('db');
  expect(reset).toHaveBeenCalledTimes(2);
  expect(reset.mock.calls.map((call) => call[2])).toEqual([true, true]);
  expect(localStorage.getItem('marker:db')).toBe('restore-1');
});

test.each(['response', 'denial'])('a restore hint supersedes an in-flight authority %s', async (outcome) => {
  localStorage.setItem('marker:db', 'restore-old');
  let finishRead!: (state: { database_restore_id: string; version: string }) => void;
  let failRead!: (error: Error) => void;
  const read = jest.fn()
    .mockImplementationOnce(() => new Promise((resolve, reject) => { finishRead = resolve; failRead = reject; }))
    .mockResolvedValue({ database_restore_id: 'restore-new', version: 'same-version' });
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);
  const pending = tracker.check('db');

  tracker.observeRestoreHint('db', 'restore-new');
  if (outcome === 'response') finishRead({ database_restore_id: 'restore-old', version: 'same-version' });
  else failRead(new Error('Previous permission denial'));
  expect(await pending).toBe(false);
  expect(read).toHaveBeenCalledTimes(3);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(tracker.marker('db')).toBe('restore-new');
  expect(tracker.verificationIsCurrent('db')).toBe(true);
});

test('a later restore hint recovers a failed reload of the superseded generation', async () => {
  let failReload!: (error: Error) => void;
  const read = jest.fn()
    .mockResolvedValueOnce({ database_restore_id: 'restore-first', version: 'same-version' })
    .mockResolvedValue({ database_restore_id: 'restore-next', version: 'same-version' });
  const reset = jest.fn()
    .mockImplementationOnce(() => new Promise((_, reject) => { failReload = reject; }))
    .mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);
  const pending = tracker.check('db');

  await Promise.resolve();
  tracker.observeRestoreHint('db', 'restore-next');
  failReload(new Error('Superseded collab unavailable'));
  expect(await pending).toBe(false);
  expect(reset).toHaveBeenCalledTimes(2);
  expect(tracker.marker('db')).toBe('restore-next');
  expect(tracker.verificationIsCurrent('db')).toBe(true);
});

test('a second restore committed during reload is resolved before synchronization resumes', async () => {
  const read = jest.fn()
    .mockResolvedValueOnce({ database_restore_id: 'restore-1', version: 'version' })
    .mockResolvedValue({ database_restore_id: 'restore-2', version: 'version' });
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);

  expect(await tracker.check('db')).toBe(false);
  expect(reset).toHaveBeenCalledTimes(2);
  expect(tracker.marker('db')).toBe('restore-2');
});


test('a stale cache witness rechecks authority without publishing or installing the older restore marker', async () => {
  localStorage.clear();
  const read = jest.fn()
    .mockResolvedValueOnce({ database_restore_id: 'restore-one', version: 'version-one', storageEpoch: null })
    .mockResolvedValue({ database_restore_id: 'restore-two', version: 'version-two', storageEpoch: 'restore-two' });
  const reset = jest.fn()
    .mockRejectedValueOnce(new DatabaseStorageGenerationChangedError())
    .mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('witness:', read, reset, localStorage);

  expect(await tracker.check('database')).toBe(false);
  expect(read).toHaveBeenCalledTimes(3);
  expect(reset).toHaveBeenNthCalledWith(2, 'database', {
    database_restore_id: 'restore-two', version: 'version-two', storageEpoch: 'restore-two',
  }, true);
  expect(tracker.marker('database')).toBe('restore-two');
  expect(localStorage.getItem('witness:database')).toBe('restore-two');
});
