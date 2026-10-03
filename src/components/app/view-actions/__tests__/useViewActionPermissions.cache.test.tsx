import { act, renderHook, waitFor } from '@testing-library/react';

import { emit, EventType } from '@/application/session/event';
import { AccessLevel, type CollabObjectPermission, Types } from '@/application/types';
import {
  clearObjectPermissionCache,
  useViewActionPermissions,
} from '@/components/app/view-actions/useViewActionPermissions';

const mockGetObjectPermission = jest.fn();
const mockGetView = jest.fn();

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getObjectPermission: (...args: unknown[]) => mockGetObjectPermission(...args),
  },
  ViewService: {
    get: (...args: unknown[]) => mockGetView(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
}));

function databasePermission(databaseId: string, overrides: Partial<CollabObjectPermission> = {}): CollabObjectPermission {
  return {
    object_id: databaseId,
    collab_type: Types.Database,
    governing_view_id: 'governing-view-id',
    access_level: AccessLevel.ReadAndWrite,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: true,
    ...overrides,
  };
}

/** A dashboard widget asking about its source database, as `useAppEmbeddedDatabasePermissions` does. */
function renderWidgetPermission(viewId: string, databaseId: string) {
  return renderHook(() =>
    useViewActionPermissions(null, true, viewId, { collabObjectId: databaseId, collabType: Types.Database })
  );
}

describe('useViewActionPermissions permission cache', () => {
  beforeEach(() => {
    mockGetObjectPermission.mockReset();
    mockGetView.mockReset();
    clearObjectPermissionCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends one request for twelve hooks on one database', async () => {
    let answer!: (permission: CollabObjectPermission) => void;

    mockGetObjectPermission.mockReturnValue(
      new Promise<CollabObjectPermission>((resolve) => {
        answer = resolve;
      })
    );

    // Twelve widgets, each on its own view of the database.
    const widgets = Array.from({ length: 12 }, (_, index) => renderWidgetPermission(`view-${index}`, 'database-id'));

    expect(mockGetObjectPermission).toHaveBeenCalledTimes(1);
    expect(mockGetObjectPermission).toHaveBeenCalledWith('workspace-id', 'database-id', Types.Database);
    widgets.forEach(({ result }) => expect(result.current.isLoadingViewActionPermissions).toBe(true));

    await act(async () => answer(databasePermission('database-id')));

    widgets.forEach(({ result }) => {
      expect(result.current.hasLoadedViewActionPermissions).toBe(true);
      expect(result.current.canWrite).toBe(true);
      expect(result.current.canShare).toBe(true);
    });
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(1);
    expect(mockGetView).not.toHaveBeenCalled();
  });

  it('asks once per database', async () => {
    mockGetObjectPermission.mockImplementation(async (_workspaceId: string, databaseId: string) =>
      databasePermission(databaseId, { can_write: databaseId === 'database-a' })
    );

    const widgets = ['database-a', 'database-b', 'database-a', 'database-b'].map((databaseId, index) => ({
      databaseId,
      ...renderWidgetPermission(`view-${index}`, databaseId),
    }));

    await waitFor(() =>
      widgets.forEach(({ result }) => expect(result.current.hasLoadedViewActionPermissions).toBe(true))
    );

    expect(mockGetObjectPermission.mock.calls).toEqual([
      ['workspace-id', 'database-a', Types.Database],
      ['workspace-id', 'database-b', Types.Database],
    ]);
    // Each widget got the answer for its own database.
    widgets.forEach(({ databaseId, result }) => {
      expect(result.current.canWrite).toBe(databaseId === 'database-a');
    });
  });

  it('reuses the answer for a widget mounted soon after, and asks again once it is stale', async () => {
    jest.useFakeTimers();
    mockGetObjectPermission.mockResolvedValue(databasePermission('database-id'));

    const first = renderWidgetPermission('view-a', 'database-id');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(first.result.current.canWrite).toBe(true);

    // A widget the scheduler starts a few seconds later.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    const second = renderWidgetPermission('view-b', 'database-id');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(second.result.current.canWrite).toBe(true);
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(1);

    // The next visit of the dashboard asks the server again.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    mockGetObjectPermission.mockResolvedValue(databasePermission('database-id', { can_write: false }));
    const third = renderWidgetPermission('view-c', 'database-id');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    expect(third.result.current.canWrite).toBe(false);
  });

  it('does not keep a failed request', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      mockGetObjectPermission.mockRejectedValueOnce(new Error('server error'));
      const failed = renderWidgetPermission('view-a', 'database-id');

      await waitFor(() => expect(failed.result.current.hasLoadedViewActionPermissions).toBe(true));
      expect(failed.result.current.canRead).toBe(false);

      mockGetObjectPermission.mockResolvedValue(databasePermission('database-id'));
      const retried = renderWidgetPermission('view-b', 'database-id');

      await waitFor(() => expect(retried.result.current.canWrite).toBe(true));
      expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not keep a refusal, so restored access shows on the next lookup', async () => {
    mockGetObjectPermission.mockResolvedValueOnce(
      databasePermission('database-id', { can_read: false, can_write: false, can_share: false, access_level: null })
    );
    const refused = renderWidgetPermission('view-a', 'database-id');

    await waitFor(() => expect(refused.result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(refused.result.current.canRead).toBe(false);

    mockGetObjectPermission.mockResolvedValue(databasePermission('database-id'));
    const restored = renderWidgetPermission('view-b', 'database-id');

    await waitFor(() => expect(restored.result.current.canRead).toBe(true));
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
  });

  it('forgets every answer when the session ends', async () => {
    mockGetObjectPermission.mockResolvedValue(databasePermission('database-id'));
    const before = renderWidgetPermission('view-a', 'database-id');

    await waitFor(() => expect(before.result.current.canWrite).toBe(true));

    // Another account signs in: the answer of the previous one must not serve it.
    act(() => {
      emit(EventType.SESSION_INVALID);
    });
    mockGetObjectPermission.mockResolvedValue(databasePermission('database-id', { can_write: false }));
    const after = renderWidgetPermission('view-b', 'database-id');

    await waitFor(() => expect(after.result.current.hasLoadedViewActionPermissions).toBe(true));
    expect(after.result.current.canWrite).toBe(false);
    expect(mockGetObjectPermission).toHaveBeenCalledTimes(2);
  });
});
