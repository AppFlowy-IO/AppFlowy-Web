import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

import { INITIAL_SERVER_RESTORE_ID } from '@/application/server-restore';

import { applyServerRestoreFence, handleServerRestoreRejection } from '../server-restore';

const mockAccept = jest.fn();
const mockAssertCurrent = jest.fn();

jest.mock('@/application/server-restore', () => ({
  ...jest.requireActual('@/application/server-restore'),
  serverRestore: {
    restoreId: '00000000-0000-0000-0000-000000000000',
    assertCurrent: () => mockAssertCurrent(),
    accept: (id: unknown) => mockAccept(id),
  },
}));

beforeEach(() => jest.clearAllMocks());

function request(url: string, params?: unknown): InternalAxiosRequestConfig {
  return { url, params, baseURL: 'https://cloud/prefix', method: 'post', headers: new AxiosHeaders() };
}

test('fences the initial HTTP upload and retries while preserving the API prefix and query', () => {
  const config = request('/api/workspace/ws/collab/full-sync?lane=slow', { extra: 'value' });

  applyServerRestoreFence(config, config.baseURL!);
  applyServerRestoreFence(config, config.baseURL!);
  const url = new URL(axios.getUri(config));

  expect(url.pathname).toBe('/prefix/api/workspace/ws/collab/full-sync');
  expect(url.searchParams.getAll('server_restore_id')).toEqual([INITIAL_SERVER_RESTORE_ID]);
  expect(url.searchParams.get('lane')).toBe('slow');
  expect(url.searchParams.get('extra')).toBe('value');
});

test.each(['/api/server-info', 'https://storage/bucket/key?signature=secret', 'https://other/api/workspace'])
('leaves discovery and external requests usable: %s', (url) => {
  const config = request(url);

  applyServerRestoreFence(config, config.baseURL!);
  expect(config.url).toBe(url);
  expect(mockAssertCurrent).not.toHaveBeenCalled();
});

test('retired tabs cannot issue another API request', () => {
  mockAssertCurrent.mockImplementationOnce(() => { throw new Error('retired'); });
  expect(() => applyServerRestoreFence(request('/api/workspace'), 'https://cloud/prefix')).toThrow('retired');
});

test('only the explicit server generation conflict triggers a reload', () => {
  const restored = '11111111-1111-4111-8111-111111111111';
  const response = { data: { data: { server_restore_id: restored } }, status: 409 };

  handleServerRestoreRejection(new AxiosError('conflict', undefined, request('/api/workspace'), undefined, response as never), 'https://cloud/prefix');
  expect(mockAccept).toHaveBeenCalledWith(restored);
  mockAccept.mockClear();
  handleServerRestoreRejection(new AxiosError('ordinary conflict', undefined, request('/api/workspace'), undefined, {
    ...response, data: { code: 409 },
  } as never), 'https://cloud/prefix');
  handleServerRestoreRejection(new AxiosError('external conflict', undefined, request('https://storage/api/upload'), undefined, response as never), 'https://cloud/prefix');
  expect(mockAccept).not.toHaveBeenCalled();
});
