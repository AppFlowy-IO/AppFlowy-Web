import { DatabaseStorageGenerationChangedError } from '@/application/db/database-storage-fence';

import { DatabaseRestoreTracker } from '../databaseRestoreState';

beforeEach(() => localStorage.clear());

test('a new restore identity resets even when the history version is unchanged', async () => {
  localStorage.setItem('marker:db', 'restore-1');
  const read = jest.fn().mockResolvedValue({ database_restore_id: 'restore-2', version: 'same-version' });
  const reset = jest.fn().mockResolvedValue(undefined);
  const tracker = new DatabaseRestoreTracker('marker:', read, reset, localStorage);

  expect(await tracker.check('db')).toBe(false);
  expect(reset).toHaveBeenCalledWith('db', { database_restore_id: 'restore-2', version: 'same-version' });
  expect(await tracker.check('db')).toBe(true);
  expect(reset).toHaveBeenCalledTimes(1);
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
  });
  expect(tracker.marker('database')).toBe('restore-two');
  expect(localStorage.getItem('witness:database')).toBe('restore-two');
});
