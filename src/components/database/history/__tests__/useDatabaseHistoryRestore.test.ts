import { act, renderHook, waitFor } from '@testing-library/react';

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
  jest.clearAllMocks();
  localStorage.clear();
});

test('persists before enqueue and reloads only after checkpoint-bearing success', async () => {
  jest.mocked(startDatabaseRestore).mockImplementation(async () => {
    expect(localStorage.length).toBe(1);
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

test('a lost enqueue response retries with the persisted idempotency key and server delay', async () => {
  jest.useFakeTimers();
  jest.mocked(startDatabaseRestore)
    .mockRejectedValueOnce({ message: 'Try again', httpStatus: 503, retryAfterSecs: 3 })
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
