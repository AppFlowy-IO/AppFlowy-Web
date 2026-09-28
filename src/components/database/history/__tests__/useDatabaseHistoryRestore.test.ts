import { act, renderHook, waitFor } from '@testing-library/react';

import { ERROR_CODE } from '@/application/constants';
import type { DatabaseRestoreJob } from '@/application/database-history.type';
import { getDatabaseRestoreJob, startDatabaseRestore } from '@/application/services/domains/database-history';

import { useDatabaseHistoryRestore } from '../useDatabaseHistoryRestore';

jest.mock('@/application/services/domains/database-history', () => ({
  getDatabaseRestoreJob: jest.fn(), startDatabaseRestore: jest.fn(),
}));
jest.mock('@/application/services/js-services/http/cloud-config', () => ({ defaultConfig: { baseURL: 'server' } }));

const job = (state: string): DatabaseRestoreJob => ({
  job_id: 'job', workspace_id: 'w', database_id: 'd', target_version: 'version', state,
  staged_bytes: 0, staged_rows: 0, result: state === 'succeeded' ? {
    version: 'version', pre_restore_version: 'recovery', restored_rows: 2, restored_documents: 0, tombstoned_rows: 1,
  } : null,
  error: null, created_at: '', updated_at: '', started_at: null, finished_at: null,
});

beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
});

afterEach(() => jest.useRealTimers());

test('persists before enqueue and reloads only after checkpoint-bearing success', async () => {
  jest.mocked(startDatabaseRestore).mockImplementation(async () => {
    expect(localStorage.length).toBe(1);
    expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).enqueueUncertain).toBe(true);
    return job('succeeded');
  });
  let finishReload!: () => void;
  const onRestored = jest.fn(() => new Promise<void>((resolve) => { finishReload = resolve; }));
  const { result } = renderHook(() => useDatabaseHistoryRestore({
    open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored,
  }));

  act(() => result.current.start('version'));
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith('d', 'job'));
  expect(result.current.completed).toBe(0);
  expect(result.current.isRestoring).toBe(true);
  expect(localStorage.length).toBe(1);
  await act(async () => finishReload());
  await waitFor(() => expect(result.current.completed).toBe(1));
  expect(onRestored).toHaveBeenCalledWith('d', 'job');
  expect(localStorage.length).toBe(0);
});

test('closing and reopening resumes the saved job without a second enqueue', async () => {
  jest.mocked(startDatabaseRestore).mockResolvedValue(job('queued'));
  jest.mocked(getDatabaseRestoreJob).mockResolvedValue(job('succeeded'));
  const onRestored = jest.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(({ open }) => useDatabaseHistoryRestore({
    open, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored,
  }), { initialProps: { open: true } });

  act(() => result.current.start('version'));
  await waitFor(() => expect(result.current.job?.state).toBe('queued'));
  rerender({ open: false });
  rerender({ open: true });
  await waitFor(() => expect(result.current.completed).toBe(1));
  expect(startDatabaseRestore).toHaveBeenCalledTimes(1);
  expect(getDatabaseRestoreJob).toHaveBeenCalledWith('w', 'd', 'job', expect.any(AbortSignal));
});

test('refuses to claim success if the server omits the mandatory recovery version', async () => {
  const response = job('succeeded');

  response.result!.pre_restore_version = null;
  jest.mocked(startDatabaseRestore).mockResolvedValue(response);
  const onRestored = jest.fn();
  const { result } = renderHook(() => useDatabaseHistoryRestore({
    open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored,
  }));

  act(() => result.current.start('version'));
  await waitFor(() => expect(result.current.error).toContain('required recovery version'));
  expect(onRestored).not.toHaveBeenCalled();
  expect(result.current.completed).toBe(0);
  expect(localStorage.length).toBe(1);
});

test.each([
  { httpStatus: 503 },
  { code: ERROR_CODE.RETRY_LATER },
  { code: ERROR_CODE.RECORD_ALREADY_EXISTS },
  { code: ERROR_CODE.REQUEST_TIMEOUT },
  { code: ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE },
  { code: ERROR_CODE.TOO_MANY_REQUESTS },
  { code: -1 },
])('an uncertain enqueue (%j) retries with the persisted idempotency key and server delay', async (details) => {
  jest.useFakeTimers();
  jest.mocked(startDatabaseRestore)
    .mockRejectedValueOnce({ message: 'Try again', ...details, retryAfterSecs: 3 })
    .mockResolvedValueOnce(job('succeeded'));
  const onRestored = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useDatabaseHistoryRestore({
    open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored,
  }));

  act(() => result.current.start('version'));
  await act(async () => { await Promise.resolve(); });
  expect(startDatabaseRestore).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(2_999); });
  expect(startDatabaseRestore).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(startDatabaseRestore).toHaveBeenCalledTimes(2);
  expect(jest.mocked(startDatabaseRestore).mock.calls[1][3])
    .toBe(jest.mocked(startDatabaseRestore).mock.calls[0][3]);
  expect(result.current.completed).toBe(1);
  jest.useRealTimers();
});

test('remounting after a reload polls the accepted job and cannot enqueue a duplicate', async () => {
  localStorage.setItem('af_database_history_restore:v1:server:user:w:d', JSON.stringify({
    version: 'version', idempotencyKey: 'original-key', jobId: 'job',
  }));
  jest.mocked(getDatabaseRestoreJob).mockResolvedValue(job('succeeded'));
  const { result } = renderHook(() => useDatabaseHistoryRestore({
    open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored: jest.fn().mockResolvedValue(undefined),
  }));

  await waitFor(() => expect(result.current.completed).toBe(1));
  expect(startDatabaseRestore).not.toHaveBeenCalled();
  expect(getDatabaseRestoreJob).toHaveBeenCalledTimes(1);
});

test.each([
  { httpStatus: 400 }, { httpStatus: 404 }, { code: 404 },
  { code: ERROR_CODE.RECORD_NOT_FOUND }, { code: ERROR_CODE.RECORD_DELETED },
  { code: ERROR_CODE.WORKSPACE_NOT_FOUND }, { code: ERROR_CODE.FEATURE_NOT_AVAILABLE },
])('a definitive enqueue rejection (%j) allows another version after reopening', async (details) => {
  jest.mocked(startDatabaseRestore)
    .mockRejectedValueOnce({ message: 'Version is unavailable', ...details })
    .mockResolvedValueOnce(job('succeeded'));
  const props = { open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored: jest.fn().mockResolvedValue(undefined) };
  const first = renderHook(() => useDatabaseHistoryRestore(props));

  act(() => first.result.current.start('removed-version'));
  await waitFor(() => expect(first.result.current.error).toBe('Version is unavailable'));
  expect(first.result.current.isRestoring).toBe(false);
  expect(localStorage.length).toBe(0);
  const firstKey = jest.mocked(startDatabaseRestore).mock.calls[0][3];

  first.unmount();
  const reopened = renderHook(() => useDatabaseHistoryRestore(props));

  act(() => reopened.result.current.start('version'));
  await waitFor(() => expect(reopened.result.current.completed).toBe(1));
  expect(startDatabaseRestore).toHaveBeenCalledTimes(2);
  expect(jest.mocked(startDatabaseRestore).mock.calls[1][2]).toBe('version');
  expect(jest.mocked(startDatabaseRestore).mock.calls[1][3]).not.toBe(firstKey);
  reopened.unmount();
});

test.each([
  { httpStatus: 401 }, { httpStatus: 403 },
  { code: ERROR_CODE.NOT_LOGGED_IN }, { code: ERROR_CODE.NOT_HAS_PERMISSION }, { code: ERROR_CODE.USER_UNAUTHORIZED },
])('authentication/permission rejection (%j) preserves an intent for reopening', async (details) => {
  jest.mocked(startDatabaseRestore)
    .mockRejectedValueOnce({ message: 'Access denied', ...details })
    .mockResolvedValueOnce(job('succeeded'));
  const { result, rerender } = renderHook(({ open }) => useDatabaseHistoryRestore({
    open, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored: jest.fn().mockResolvedValue(undefined),
  }), { initialProps: { open: true } });

  act(() => result.current.start('version'));
  await waitFor(() => expect(result.current.error).toBe('Access denied'));
  expect(result.current.isRestoring).toBe(true);
  expect(localStorage.length).toBe(1);
  expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).enqueueUncertain).toBe(false);
  rerender({ open: false });
  rerender({ open: true });
  await waitFor(() => expect(result.current.completed).toBe(1));
  expect(jest.mocked(startDatabaseRestore).mock.calls[1][3])
    .toBe(jest.mocked(startDatabaseRestore).mock.calls[0][3]);
});

test.each([
  { httpStatus: 403 }, { httpStatus: 404 },
  { code: ERROR_CODE.NOT_HAS_PERMISSION }, { code: ERROR_CODE.RECORD_NOT_FOUND },
])('an inaccessible accepted job (%j) remains pending and resumes without another enqueue', async (details) => {
  jest.useFakeTimers();
  const key = 'af_database_history_restore:v1:server:user:w:d';

  localStorage.setItem(key, JSON.stringify({ version: 'version', idempotencyKey: 'original-key', jobId: 'job' }));
  jest.mocked(getDatabaseRestoreJob)
    .mockRejectedValueOnce({ message: 'Job inaccessible', ...details })
    .mockResolvedValueOnce(job('succeeded'));
  const { result, rerender } = renderHook(({ open }) => useDatabaseHistoryRestore({
    open, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored: jest.fn().mockResolvedValue(undefined),
  }), { initialProps: { open: true } });

  await waitFor(() => expect(result.current.error).toBe('Job inaccessible'));
  expect(result.current.isRestoring).toBe(true);
  expect(JSON.parse(localStorage.getItem(key)!).jobId).toBe('job');
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(getDatabaseRestoreJob).toHaveBeenCalledTimes(1);
  act(() => result.current.start('another-version'));
  expect(startDatabaseRestore).not.toHaveBeenCalled();
  rerender({ open: false });
  rerender({ open: true });
  await waitFor(() => expect(result.current.completed).toBe(1));
  expect(startDatabaseRestore).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test.each([{ httpStatus: 404 }, { code: ERROR_CODE.RECORD_NOT_FOUND }])(
  'an interrupted enqueue remains uncertain across remount and a later rejection (%j)', async (details) => {
  jest.useFakeTimers();
  const key = 'af_database_history_restore:v1:server:user:w:d';
  let finishEnqueue!: (value: DatabaseRestoreJob) => void;

  jest.mocked(startDatabaseRestore)
    .mockImplementationOnce(() => new Promise((resolve) => { finishEnqueue = resolve; }))
    .mockRejectedValueOnce({ message: 'Version not found', ...details });
  const props = { open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored: jest.fn() };
  const first = renderHook(() => useDatabaseHistoryRestore(props));

  act(() => first.result.current.start('version'));
  await waitFor(() => expect(startDatabaseRestore).toHaveBeenCalledTimes(1));
  expect(JSON.parse(localStorage.getItem(key)!).enqueueUncertain).toBe(true);
  first.unmount();
  const reopened = renderHook(() => useDatabaseHistoryRestore(props));

  await waitFor(() => expect(reopened.result.current.error).toBe('Version not found'));
  expect(reopened.result.current.isRestoring).toBe(true);
  expect(jest.mocked(startDatabaseRestore).mock.calls[1][3])
    .toBe(jest.mocked(startDatabaseRestore).mock.calls[0][3]);
  await act(async () => { jest.advanceTimersByTime(30_000); });
  act(() => reopened.result.current.start('another-version'));
  expect(startDatabaseRestore).toHaveBeenCalledTimes(2);
  await act(async () => finishEnqueue(job('queued')));
  reopened.unmount();
  jest.useRealTimers();
});

test('legacy saved enqueue intents are treated as uncertain when a retry is rejected', async () => {
  const key = 'af_database_history_restore:v1:server:user:w:d';

  localStorage.setItem(key, JSON.stringify({ version: 'version', idempotencyKey: 'legacy-key' }));
  jest.mocked(startDatabaseRestore).mockRejectedValueOnce({ message: 'Version not found', httpStatus: 404 });
  const { result } = renderHook(() => useDatabaseHistoryRestore({
    open: true, userId: 'user', workspaceId: 'w', databaseId: 'd', onRestored: jest.fn(),
  }));

  await waitFor(() => expect(result.current.error).toBe('Version not found'));
  expect(result.current.isRestoring).toBe(true);
  expect(JSON.parse(localStorage.getItem(key)!).idempotencyKey).toBe('legacy-key');
});
