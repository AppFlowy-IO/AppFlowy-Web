import axios from 'axios';

import { postRowCreation } from '../atomic-row-creation-api';
import type { AtomicCreationOwner } from '@/application/atomic-creation/owner';

const mockPost = jest.fn();
const mockGuard = jest.fn();
jest.mock('@/application/atomic-creation/owner', () => ({ assertAtomicCreationAvailable: () => mockGuard() }));
jest.mock('../atomic-creation-api', () => ({
  ownedRequestConfig: () => ({}),
  awaitAtomicRequest: (promise: Promise<unknown>) => promise,
}));
jest.mock('../core', () => ({
  getAxios: () => ({ post: mockPost }),
  executeAPIRequest: async (action: () => Promise<{ data: { code: number; data: unknown } }>) => {
    try {
      const response = await action();

      if (response.data.code !== 0) throw { code: response.data.code };
      return response.data.data;
    } catch (error) {
      // Real API boundary normalizes Axios failures; retries cannot inspect only the caught value.
      if (axios.isAxiosError(error)) throw { code: -1, transportFailure: 'network' };
      throw error;
    }
  },
}));

const owner = { workspaceId: 'workspace', assertCurrent: jest.fn() } as unknown as AtomicCreationOwner;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

it('retries a lost reply with byte-identical command and returns one acknowledged result', async () => {
  mockPost
    .mockRejectedValueOnce(new axios.AxiosError('lost reply', 'ERR_NETWORK'))
    .mockResolvedValueOnce({ data: { code: 0, data: { outcome: 'already_applied' } } });
  const command = { request_id: 'same-request', cells: { title: { data: 'frozen' } } };
  const pending = postRowCreation(
    owner,
    'database/db/row/default',
    command,
    new AbortController().signal,
    Date.now() + 30_000
  );

  command.cells.title.data = 'changed after dispatch';
  await jest.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toEqual({ outcome: 'already_applied' });
  expect(mockPost).toHaveBeenCalledTimes(2);
  expect(mockPost.mock.calls[0][1]).toBe(mockPost.mock.calls[1][1]);
  expect(JSON.parse(mockPost.mock.calls[1][1]).cells.title.data).toBe('frozen');
});

it('retries committed RetryLater but never retries a deterministic refusal', async () => {
  mockPost.mockResolvedValueOnce({ data: { code: -5 } }).mockResolvedValueOnce({ data: { code: 0, data: 'created' } });
  const pending = postRowCreation(
    owner,
    'database/db/row/default',
    {},
    new AbortController().signal,
    Date.now() + 30_000
  );

  await jest.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toBe('created');
  mockPost.mockClear();
  mockPost.mockResolvedValue({ data: { code: 403 } });
  await expect(
    postRowCreation(owner, 'database/db/row/default', {}, new AbortController().signal, Date.now() + 30_000)
  ).rejects.toMatchObject({ code: 403 });
  expect(mockPost).toHaveBeenCalledTimes(1);
});

it('cancellation during backoff releases its timer and sends no further request', async () => {
  mockPost.mockResolvedValue({ data: { code: -5 } });
  const controller = new AbortController();
  const pending = postRowCreation(owner, 'database/db/row/default', {}, controller.signal, Date.now() + 30_000);
  const rejected = expect(pending).rejects.toThrow('left database');

  await jest.advanceTimersByTimeAsync(0);
  controller.abort(new Error('left database'));
  await rejected;
  await jest.runOnlyPendingTimersAsync();
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([404, 405])('reports an unsupported server route (%s) without a legacy creation fallback', async (code) => {
  mockPost.mockResolvedValue({ data: { code } });
  await expect(
    postRowCreation(owner, 'database/db/row/default', {}, new AbortController().signal, Date.now() + 30_000)
  ).rejects.toMatchObject({ user_error: { reason: 'ATOMIC_CREATION_SERVER_UPGRADE' } });
  expect(mockPost).toHaveBeenCalledTimes(1);
});
