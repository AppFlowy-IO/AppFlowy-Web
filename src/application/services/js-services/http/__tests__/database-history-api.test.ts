import { database_blob } from '@/proto/database_blob';

import { getAxios } from '../core';
import { getDatabaseHistory, getDatabaseHistoryRows, previewDatabaseVersion, startDatabaseRestore } from '../database-history-api';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: jest.fn(async (request) => (await request()).data.data),
  handleAPIError: (error: unknown) => error,
}));

const get = jest.fn();
const post = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAxios).mockReturnValue({ get, post } as never);
});

test('forwards the original microsecond cursor and abort signal', async () => {
  get.mockResolvedValue({ data: { data: [] } });
  const signal = new AbortController().signal;
  const cursor = { before_changed_at: '2026-09-10T12:00:00.123456Z', before_version: 'version' };

  await getDatabaseHistory('workspace', 'database', { cursor, signal });
  expect(get).toHaveBeenCalledWith('/api/workspace/workspace/database/database/history', {
    params: { limit: 30, ...cursor }, signal,
  });
});

test('decodes immutable binary row pages without going through the live blob API', async () => {
  const payload = database_blob.DatabaseBlobDiffResponse.encode({
    manifestVersion: 'version', status: database_blob.DiffStatus.READY,
    page: { hasMore: true, nextCursor: new Uint8Array([110, 101, 120, 116]) },
  }).finish();

  get.mockResolvedValue({ data: payload, headers: { 'content-type': 'application/octet-stream' } });
  const page = await getDatabaseHistoryRows('workspace', 'database', 'version', { cursor: 'previous' });

  expect(page.manifestVersion).toBe('version');
  expect(page.page?.hasMore).toBe(true);
  expect(get).toHaveBeenCalledWith('/api/workspace/workspace/database/database/history/version/preview/rows',
    expect.objectContaining({ responseType: 'arraybuffer', params: { cursor: 'previous', limit: 256 } }));
});

test('rejects rows for a different version and missing rows', async () => {
  for (const payload of [
    { manifestVersion: 'wrong' },
    { manifestVersion: 'version', missingRowIds: [new Uint8Array(16)] },
    { manifestVersion: 'version', page: { restartRequired: true } },
  ]) {
    get.mockResolvedValue({
      data: database_blob.DatabaseBlobDiffResponse.encode(payload).finish(), headers: {},
    });
    await expect(getDatabaseHistoryRows('w', 'd', 'version')).rejects.toThrow('no longer available');
  }
});

test('rejects missing API initialization', async () => {
  jest.mocked(getAxios).mockReturnValue(null);
  await expect(previewDatabaseVersion('w', 'd', 'v')).rejects.toThrow('not initialized');
});

test('restore always requires a checkpoint and uses the supplied idempotency key', async () => {
  post.mockResolvedValue({ data: { data: { job_id: 'job' } } });
  await startDatabaseRestore('w', 'd', 'v', 'stable-key');
  expect(post).toHaveBeenCalledWith('/api/workspace/w/database/d/history/v/restore-jobs',
    { require_checkpoint: true }, { headers: { 'Idempotency-Key': 'stable-key' } });
});
