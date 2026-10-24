import type { TokenSessionWitness } from '@/application/session/token';
import { AccessLevel, type CollabObjectPermission, Types } from '@/application/types';
import { isPermissionDeniedError } from '@/application/utils/error-utils';

import { getObjectPermission, invalidateObjectPermissionRequests } from '../access-api';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNormalize = jest.fn((error) => error);
let mockBatchEnabled = true;
let mockSession: TokenSessionWitness = { generation: 1, userId: 'user-1' };

jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => ({ ...mockSession }),
  isTokenSessionCurrent: (session: TokenSessionWitness) =>
    session.generation === mockSession.generation && session.userId === mockSession.userId,
  getTokenParsed: () => ({ user: { id: mockSession.userId } }),
}));

jest.mock('@/utils/server-info', () => ({
  getServerInfoSnapshot: () => ({ status: 'available', info: { enable_object_permission_batch: mockBatchEnabled } }),
  getServerHostingMode: () => 'unknown',
}));

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet, post: mockPost }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
  handleAPIError: (error: unknown) => mockNormalize(error),
  withRetry: jest.requireActual('../core').withRetry,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function permission(object_id: string, collab_type = Types.Database): CollabObjectPermission {
  return {
    object_id,
    collab_type,
    governing_view_id: 'view-1',
    access_level: AccessLevel.FullAccess,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: true,
  };
}

function result(object_id: string, collab_type = Types.Database) {
  return { object_id, collab_type, permission: permission(object_id, collab_type) };
}

function response(ids: string[]) {
  return { data: { data: { results: ids.map((id) => result(id)) } } };
}

function flushQueue() {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe('capability-gated object permission batching', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockNormalize.mockClear();
    mockBatchEnabled = true;
    mockSession = { generation: mockSession.generation + 1, userId: 'user-1' };
    mockPost.mockImplementation((_url, body) =>
      Promise.resolve({
        data: {
          data: {
            results: body.objects.map((object: { object_id: string; collab_type: Types }) =>
              result(object.object_id, object.collab_type)
            ),
          },
        },
      })
    );
    mockGet.mockImplementation((url, config) =>
      Promise.resolve({ data: { data: permission(url.split('/').at(-2), config.params.collab_type) } })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('coalesces distinct same-turn reads and retains same-key deduplication', async () => {
    const requests = ['a', 'b', 'a'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    expect(mockPost).not.toHaveBeenCalled();
    await expect(Promise.all(requests)).resolves.toEqual(['a', 'b', 'a'].map((id) => permission(id)));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][1].objects).toEqual([
      { object_id: 'a', collab_type: Types.Database },
      { object_id: 'b', collab_type: Types.Database },
    ]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('retains singleton GET and leaves flag-off reads immediate and independent', async () => {
    await expect(getObjectPermission('workspace-1', 'a', Types.Database)).resolves.toEqual(permission('a'));
    expect(mockGet).toHaveBeenCalledTimes(1);
    mockBatchEnabled = false;
    const requests = ['b', 'c'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    expect(mockGet).toHaveBeenCalledTimes(3);
    await Promise.all(requests);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('caps batches at 200 objects and limits outstanding requests to four', async () => {
    const releases: Array<() => void> = [];
    const fifth = deferred<void>();

    mockPost.mockImplementation((_url, body) => {
      const pending = deferred<ReturnType<typeof response>>();

      releases.push(() =>
        pending.resolve(response(body.objects.map((object: { object_id: string }) => object.object_id)))
      );
      if (releases.length === 5) fifth.resolve();
      return pending.promise;
    });
    const requests = Array.from({ length: 1001 }, (_, index) =>
      getObjectPermission('workspace-1', `database-${index}`, Types.Database)
    );

    await flushQueue();
    expect(mockPost).toHaveBeenCalledTimes(4);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost.mock.calls.every((call) => call[1].objects.length === 200)).toBe(true);
    releases[0]();
    await fifth.promise;
    releases.slice(1).forEach((release) => release());
    await expect(Promise.all(requests)).resolves.toHaveLength(1001);
    expect(mockPost).toHaveBeenCalledTimes(5);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('keeps workspaces and collab types correctly associated', async () => {
    const requests = [
      getObjectPermission('workspace-1', 'a', Types.Database),
      getObjectPermission('workspace-1', 'a', Types.Document),
      getObjectPermission('workspace-2', 'a', Types.Database),
      getObjectPermission('workspace-2', 'b', Types.Database),
    ];

    await expect(Promise.all(requests)).resolves.toEqual([
      permission('a'),
      permission('a', Types.Document),
      permission('a'),
      permission('b'),
    ]);
    expect(mockPost.mock.calls.map((call) => call[0])).toEqual([
      '/api/workspace/workspace-1/permissions',
      '/api/workspace/workspace-2/permissions',
    ]);
  });

  it('bounds retained queued objects and rejects overflow without sending them', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 2001 }, (_, index) => getObjectPermission('workspace-1', `database-${index}`, Types.Database))
    );

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(2000);
    expect(outcomes[2000]).toEqual({
      status: 'rejected',
      reason: {
        code: -1,
        message: 'Object permission queue is full',
        sourceDomain: 'client',
      },
    });
    expect(mockPost).toHaveBeenCalledTimes(10);
  });

  it('discards queued reads invalidated before sending and joins one fresh cohort', async () => {
    const requests = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    invalidateObjectPermissionRequests('workspace-1');
    await expect(Promise.all(requests)).resolves.toEqual([permission('a'), permission('b')]);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('rejects queued work from a previous session before sending', async () => {
    const old = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));
    const rejected = Promise.allSettled(old);

    mockSession = { generation: mockSession.generation + 1, userId: 'user-2' };
    const current = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    expect((await rejected).every((outcome) => outcome.status === 'rejected')).toBe(true);
    await Promise.all(current);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('normalizes per-item errors without rejecting successful peers', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          results: [
            result('a'),
            {
              object_id: 'b',
              collab_type: Types.Database,
              error: 'denied',
              error_code: 1012,
            },
          ],
        },
      },
    });
    const outcomes = await Promise.allSettled(
      ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database))
    );

    expect(outcomes[0]).toEqual({ status: 'fulfilled', value: permission('a') });
    expect(outcomes[1]).toEqual({
      status: 'rejected',
      reason: {
        code: 1012,
        message: 'denied',
        sourceDomain: 'appflowy.server',
      },
    });
    expect(mockNormalize).toHaveBeenCalledWith({ code: 1012, message: 'denied', sourceDomain: 'appflowy.server' });
    if (outcomes[1].status === 'rejected') expect(isPermissionDeniedError(outcomes[1].reason)).toBe(true);
  });

  it('retries transient POST reads with the existing bounded retry helper', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockPost.mockRejectedValueOnce({
      code: -1,
      message: 'network unavailable',
      sourceDomain: 'transport',
      transportFailure: 'network',
    });
    const requests = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    await jest.advanceTimersByTimeAsync(999);
    expect(mockPost).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(Promise.all(requests)).resolves.toEqual([permission('a'), permission('b')]);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After on HTTP throttling without creating individual GET retries', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockPost.mockRejectedValueOnce({
      code: 429,
      message: 'rate limited',
      sourceDomain: 'http',
      httpStatus: 429,
      retryAfterSecs: 3,
    });
    const requests = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    await jest.advanceTimersByTimeAsync(2999);
    expect(mockPost).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(requests);
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('stops after three transport retries and never treats overload as a denial', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const overload = { code: 503, message: 'overloaded', sourceDomain: 'http', httpStatus: 503 };

    mockPost.mockRejectedValue(overload);
    const outcomes = Promise.allSettled(['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database)));

    await jest.runAllTimersAsync();
    expect((await outcomes).every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(4);
    expect(isPermissionDeniedError(overload)).toBe(false);
  });

  it('preserves whole-batch application retry errors and their caller-owned recovery policy', async () => {
    const retry = {
      code: 1079,
      message: 'mapping admission unavailable',
      sourceDomain: 'appflowy.server',
      httpStatus: 200,
      retryAfterSecs: 2,
    };

    mockPost.mockRejectedValueOnce(retry);
    const outcomes = await Promise.allSettled(
      ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database))
    );

    expect(outcomes).toEqual([
      { status: 'rejected', reason: retry },
      { status: 'rejected', reason: retry },
    ]);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(isPermissionDeniedError(retry)).toBe(false);
  });

  it('does not retry a POST cohort after its login lifetime changes during backoff', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockPost.mockRejectedValueOnce({
      code: -1,
      message: 'network unavailable',
      sourceDomain: 'transport',
      transportFailure: 'network',
    });
    const outcomes = Promise.allSettled(['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database)));

    await jest.advanceTimersByTimeAsync(1);
    mockSession = { generation: mockSession.generation + 1, userId: 'user-2' };
    await jest.runAllTimersAsync();
    expect((await outcomes).every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('replaces an invalidated retry cohort with one fresh read', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockPost.mockRejectedValueOnce({
      code: -1,
      message: 'network unavailable',
      sourceDomain: 'transport',
      transportFailure: 'network',
    });
    const requests = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    await jest.advanceTimersByTimeAsync(1);
    invalidateObjectPermissionRequests('workspace-1');
    await jest.runAllTimersAsync();
    await expect(Promise.all(requests)).resolves.toEqual([permission('a'), permission('b')]);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it.each(['order', 'type', 'identity', 'missing-code'])('fails closed on malformed %s', async (kind) => {
    const results: unknown[] = [result('a'), result('b')];

    if (kind === 'order') results.reverse();
    if (kind === 'type') results[1] = result('b', Types.Document);
    if (kind === 'identity') results[1] = { ...result('b'), permission: permission('other') };
    if (kind === 'missing-code') results[1] = { object_id: 'b', collab_type: Types.Database, error: 'unknown' };
    mockPost.mockResolvedValueOnce({ data: { data: { results } } });
    const outcomes = await Promise.allSettled(
      ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database))
    );

    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
  });

  it('rechecks both stale allows and denials after workspace invalidation', async () => {
    const beforeChange = deferred<unknown>();

    mockPost.mockReturnValueOnce(beforeChange.promise);
    const requests = ['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database));

    await flushQueue();
    invalidateObjectPermissionRequests('workspace-1');
    beforeChange.resolve({
      data: {
        data: {
          results: [
            result('a'),
            {
              object_id: 'b',
              collab_type: Types.Database,
              error: 'denied',
              error_code: 1012,
            },
          ],
        },
      },
    });
    await expect(Promise.all(requests)).resolves.toEqual([permission('a'), permission('b')]);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('never delivers or retries an in-flight response into a new login session', async () => {
    const pending = deferred<ReturnType<typeof response>>();

    mockPost.mockReturnValueOnce(pending.promise);
    const outcomes = Promise.allSettled(['a', 'b'].map((id) => getObjectPermission('workspace-1', id, Types.Database)));

    await flushQueue();
    mockSession = { generation: mockSession.generation + 1, userId: 'user-1' };
    pending.resolve(response(['a', 'b']));
    expect((await outcomes).every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
