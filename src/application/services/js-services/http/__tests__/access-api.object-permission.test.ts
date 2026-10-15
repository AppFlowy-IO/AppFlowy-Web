import type { TokenSessionWitness } from '@/application/session/token';
import { AccessLevel, type CollabObjectPermission, Types } from '@/application/types';

import { getObjectPermission, invalidateObjectPermissionRequests, invalidateShareDetailCache } from '../access-api';

const mockGet = jest.fn();
let mockSession: TokenSessionWitness = { generation: 1, userId: 'user-1' };

jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => ({ ...mockSession }),
  isTokenSessionCurrent: (session: TokenSessionWitness) =>
    session.generation === mockSession.generation && session.userId === mockSession.userId,
  getTokenParsed: () => ({ user: { id: mockSession.userId } }),
}));

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: CollabObjectPermission } }>) =>
    (await request()).data.data,
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

const permission: CollabObjectPermission = {
  object_id: 'database-1',
  collab_type: Types.Database,
  governing_view_id: 'view-1',
  access_level: AccessLevel.FullAccess,
  can_read: true,
  can_write: true,
  can_comment: true,
  can_share: true,
};
const response = { data: { data: permission } };

describe('object permission request sharing', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSession = { generation: mockSession.generation + 1, userId: 'user-1' };
  });

  it('shares five embedded database reads only while their canonical request is pending', async () => {
    const pending = deferred<typeof response>();

    mockGet.mockReturnValueOnce(pending.promise).mockResolvedValue(response);
    const requests = Array.from({ length: 5 }, () => getObjectPermission('workspace-1', 'database-1', Types.Database));

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/workspace/workspace-1/collab/database-1/permission', {
      params: { collab_type: Types.Database },
    });
    pending.resolve(response);
    await expect(Promise.all(requests)).resolves.toEqual(Array(5).fill(permission));

    await expect(getObjectPermission('workspace-1', 'database-1', Types.Database)).resolves.toEqual(permission);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('keeps different workspaces, objects, and collab types independent', async () => {
    mockGet.mockResolvedValue(response);
    const requests = [
      getObjectPermission('workspace-1', 'database-1', Types.Database),
      getObjectPermission('workspace-2', 'database-1', Types.Database),
      getObjectPermission('workspace-1', 'database-2', Types.Database),
      getObjectPermission('workspace-1', 'database-1', Types.Document),
    ];

    expect(mockGet).toHaveBeenCalledTimes(4);
    await Promise.all(requests);
  });

  it('does not share or deliver permissions across account and login session changes', async () => {
    const pending = deferred<typeof response>();

    mockGet.mockReturnValue(pending.promise);
    const previousUser = getObjectPermission('workspace-1', 'database-1', Types.Database);
    const previousUserResult = expect(previousUser).rejects.toThrow('superseded');

    mockSession = { generation: mockSession.generation + 1, userId: 'user-2' };
    const secondUser = getObjectPermission('workspace-1', 'database-1', Types.Database);
    const secondUserResult = expect(secondUser).rejects.toThrow('superseded');

    // Even logging back into the original account creates a new lifetime.
    mockSession = { generation: mockSession.generation + 1, userId: 'user-1' };
    const newSession = getObjectPermission('workspace-1', 'database-1', Types.Database);

    expect(mockGet).toHaveBeenCalledTimes(3);
    pending.resolve(response);
    await Promise.all([previousUserResult, secondUserResult]);
    await expect(newSession).resolves.toEqual(permission);
  });

  it('forgets a failed shared request so the next probe can retry', async () => {
    const pending = deferred<typeof response>();

    mockGet.mockReturnValueOnce(pending.promise).mockResolvedValue(response);
    const first = getObjectPermission('workspace-1', 'database-1', Types.Database);
    const second = getObjectPermission('workspace-1', 'database-1', Types.Database);
    const outcomes = Promise.allSettled([first, second]);

    pending.reject(new Error('Network unavailable'));
    expect(await outcomes).toEqual([
      { status: 'rejected', reason: new Error('Network unavailable') },
      { status: 'rejected', reason: new Error('Network unavailable') },
    ]);
    await expect(getObjectPermission('workspace-1', 'database-1', Types.Database)).resolves.toEqual(permission);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it.each([invalidateObjectPermissionRequests, invalidateShareDetailCache])(
    'joins a fresh request after invalidation instead of stranding existing consumers (%p)',
    async (invalidate) => {
      const beforeChange = deferred<typeof response>();
      const afterChange = deferred<typeof response>();

      mockGet.mockReturnValueOnce(beforeChange.promise).mockReturnValueOnce(afterChange.promise);
      const stale = getObjectPermission('workspace-1', 'database-1', Types.Database);

      invalidate('workspace-1');
      const fresh = getObjectPermission('workspace-1', 'database-1', Types.Database);

      expect(mockGet).toHaveBeenCalledTimes(2);
      beforeChange.resolve(response);
      // Allow every continuation of the old response to join its replacement.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Completion of the old request must not evict its pending replacement.
      const concurrent = getObjectPermission('workspace-1', 'database-1', Types.Database);

      expect(mockGet).toHaveBeenCalledTimes(2);
      const downgraded = { ...permission, can_write: false, can_share: false };

      afterChange.resolve({ data: { data: downgraded } });
      await expect(Promise.all([stale, fresh, concurrent])).resolves.toEqual([downgraded, downgraded, downgraded]);
    }
  );

  it('coalesces retries for mounted embeds even when no new consumer starts a read', async () => {
    const beforeChange = deferred<typeof response>();
    const afterChange = deferred<typeof response>();
    const downgraded = { ...permission, can_write: false, can_share: false };

    mockGet.mockReturnValueOnce(beforeChange.promise).mockReturnValueOnce(afterChange.promise);
    const requests = Array.from({ length: 5 }, () => getObjectPermission('workspace-1', 'database-1', Types.Database));

    invalidateObjectPermissionRequests('workspace-1');
    beforeChange.resolve(response);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGet).toHaveBeenCalledTimes(2);
    afterChange.resolve({ data: { data: downgraded } });
    await expect(Promise.all(requests)).resolves.toEqual(Array(5).fill(downgraded));
  });

  it('rechecks an invalidated denial instead of delivering a stale 403', async () => {
    const beforeRestore = deferred<typeof response>();

    mockGet.mockReturnValueOnce(beforeRestore.promise).mockResolvedValue(response);
    const pending = getObjectPermission('workspace-1', 'database-1', Types.Database);

    invalidateObjectPermissionRequests('workspace-1');
    beforeRestore.reject({ code: 403, message: 'Permission denied' });
    await expect(pending).resolves.toEqual(permission);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('limits invalidation retries and remains fail closed if the replacement is superseded too', async () => {
    const beforeChange = deferred<typeof response>();
    const afterChange = deferred<typeof response>();

    mockGet.mockReturnValueOnce(beforeChange.promise).mockReturnValueOnce(afterChange.promise);
    const pending = getObjectPermission('workspace-1', 'database-1', Types.Database);
    const result = expect(pending).rejects.toThrow('superseded');

    invalidateObjectPermissionRequests('workspace-1');
    beforeChange.resolve(response);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGet).toHaveBeenCalledTimes(2);
    invalidateObjectPermissionRequests('workspace-1');
    afterChange.resolve(response);
    await result;
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('does not retry an invalidated read into a new login session', async () => {
    const beforeChange = deferred<typeof response>();

    mockGet.mockReturnValueOnce(beforeChange.promise);
    const pending = getObjectPermission('workspace-1', 'database-1', Types.Database);
    const result = expect(pending).rejects.toThrow('superseded');

    invalidateObjectPermissionRequests('workspace-1');
    mockSession = { generation: mockSession.generation + 1, userId: 'user-1' };
    beforeChange.resolve(response);
    await result;
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate pending permissions belonging to a different workspace', async () => {
    const pending = deferred<typeof response>();

    mockGet.mockReturnValue(pending.promise);
    const first = getObjectPermission('workspace-2', 'database-1', Types.Database);

    invalidateObjectPermissionRequests('workspace-1');
    const second = getObjectPermission('workspace-2', 'database-1', Types.Database);

    expect(mockGet).toHaveBeenCalledTimes(1);
    pending.resolve(response);
    await expect(Promise.all([first, second])).resolves.toEqual([permission, permission]);
  });
});
