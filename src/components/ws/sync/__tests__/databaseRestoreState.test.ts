import { ERROR_CODE } from '@/application/constants';
import { DatabaseStorageGenerationChangedError } from '@/application/db/database-storage-fence';

import { DatabaseRestoreTracker, DatabaseRestoreVerificationDeferredError } from '../databaseRestoreState';

beforeEach(() => localStorage.clear());
afterEach(() => jest.useRealTimers());

test.each([429, 500])('permanent permission codes remain terminal even with HTTP %s and Retry-After', async (httpStatus) => {
  const denied = { code: ERROR_CODE.NOT_HAS_PERMISSION, httpStatus, retryAfterSecs: 60 };
  const read = jest.fn().mockRejectedValue(denied);
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);

  await expect(tracker.check('db')).rejects.toBe(denied);
  await expect(tracker.check('db')).rejects.toBe(denied);
  expect(read).toHaveBeenCalledTimes(2);
});

test('an enormous finite Retry-After cannot overflow the shared deadline', async () => {
  const read = jest.fn().mockRejectedValue({ code: 429, retryAfterSecs: 1e308 });
  const tracker = new DatabaseRestoreTracker('marker:', read, jest.fn(), localStorage);
  const result = await tracker.check('db').catch((error) => error);

  expect(result).toBeInstanceOf(DatabaseRestoreVerificationDeferredError);
  expect(Number.isSafeInteger(result.retryAtMs)).toBe(true);
  expect(Number.isFinite(result.retryAfterSecs)).toBe(true);
  await expect(tracker.check('db')).rejects.toBe(result);
  expect(read).toHaveBeenCalledTimes(1);
});

test.each([
  { code: ERROR_CODE.TOO_MANY_REQUESTS, httpStatus: 429 },
  { code: ERROR_CODE.RETRY_LATER },
  { code: ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE, httpStatus: 503 },
])('all callers respect the original retry deadline after authority failure %o', async (detail) => {
  jest.useFakeTimers();
  const read = jest.fn().mockRejectedValueOnce({ ...detail, retryAfterSecs: 7 })
    .mockResolvedValue({ database_restore_id: null, version: null });
  const reset = jest.fn();
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);
  const initial = await Promise.allSettled(Array.from({ length: 32 }, () => tracker.check('db')));

  expect(initial.every((result) => result.status === 'rejected')).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(3000);
  const staggered = await Promise.allSettled(Array.from({ length: 32 }, () => tracker.check('db')));

  expect(staggered.every((result) => result.status === 'rejected')).toBe(true);
  expect(staggered[0]).toMatchObject({ status: 'rejected', reason: { ...detail, retryAfterSecs: 4 } });
  expect(read).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
  expect(localStorage.getItem('marker:db')).toBeNull();
  jest.advanceTimersByTime(4000);
  expect(await tracker.check('db')).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
});

test('a hint during a busy authority read stays fenced until a fresh post-deadline verification', async () => {
  jest.useFakeTimers();
  localStorage.setItem('marker:db', 'restore-old');
  let rejectRead!: (reason: unknown) => void;
  const read = jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject; }))
    .mockResolvedValue({ database_restore_id: 'restore-new', version: 'version' });
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);
  const initial = tracker.check('db');

  tracker.observeRestoreHint('db', 'restore-new');
  rejectRead({ code: ERROR_CODE.TOO_MANY_REQUESTS, httpStatus: 429, retryAfterSecs: 7 });
  await expect(initial).rejects.toMatchObject({ code: ERROR_CODE.TOO_MANY_REQUESTS });
  await expect(tracker.check('db')).rejects.toMatchObject({ retryAfterSecs: 7 });
  expect(read).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
  expect(tracker.marker('db')).toBe('restore-old');
  expect(tracker.verificationIsCurrent('db')).toBe(false);
  jest.advanceTimersByTime(7000);
  expect(await tracker.check('db')).toBe(false);
  expect(read).toHaveBeenCalledTimes(3);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(tracker.marker('db')).toBe('restore-new');
  expect(tracker.verificationIsCurrent('db')).toBe(true);
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
