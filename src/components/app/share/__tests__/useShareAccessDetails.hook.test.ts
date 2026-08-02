import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { AccessLevel, IPeopleWithAccessType, Role, View, ViewLayout } from '@/application/types';
import { useShareAccessDetails } from '@/components/app/share/useShareAccessDetails';

const mockEventEmitter = new EventEmitter();
const mockGetShareDetail = jest.fn();
const mockInvalidateShareDetailCache = jest.fn();
let mockOutline: View[] = [];

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getShareDetail: (...args: unknown[]) => mockGetShareDetail(...args),
    invalidateShareDetailCache: (...args: unknown[]) => mockInvalidateShareDetailCache(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => mockOutline,
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
  useUserWorkspaceInfo: () => ({ selectedWorkspace: { memberCount: 2 } }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'owner@appflowy.io' }),
}));

const removedPerson: IPeopleWithAccessType = {
  email: 'removed@appflowy.io',
  name: 'Removed user',
  access_level: AccessLevel.ReadOnly,
  role: Role.Guest,
  avatar_url: '',
  pending_invitation: false,
};

describe('useShareAccessDetails', () => {
  beforeEach(() => {
    mockEventEmitter.removeAllListeners();
    mockGetShareDetail.mockReset();
    mockInvalidateShareDetailCache.mockReset();
    mockOutline = [
      {
        view_id: 'view-1',
        name: 'Shared page',
        icon: null,
        layout: ViewLayout.Document,
        extra: null,
        children: [],
        is_published: false,
        is_private: true,
      },
    ];
  });

  it('invalidates and reloads an open access list after a remote share change', async () => {
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockResolvedValueOnce({ shared_with: [] });

    const { result, unmount } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: 'view-1',
        emails: [removedPerson.email],
      });
    });

    await waitFor(() => expect(result.current.people).toEqual([]));
    expect(mockInvalidateShareDetailCache).toHaveBeenCalledWith('workspace-1');
    expect(mockGetShareDetail).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('removes a successfully revoked person from local state immediately', async () => {
    mockGetShareDetail.mockResolvedValueOnce({ shared_with: [removedPerson] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => result.current.removePersonFromAccessList('REMOVED@appflowy.io'));

    expect(result.current.people).toEqual([]);
  });

  it('clears stale people and privileged controls after a definitive denial', async () => {
    mockOutline[0].access_level = AccessLevel.FullAccess;
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockRejectedValueOnce({ code: 1012, message: 'Not enough permissions' });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.hasFullAccess).toBe(true));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });

    await waitFor(() => expect(result.current.people).toEqual([]));
    expect(result.current.currentUserAccessLevel).toBeUndefined();
    expect(result.current.hasFullAccess).toBe(false);
  });

  it('retries a transient notification refresh and applies the fresh list', async () => {
    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockRejectedValueOnce({ code: 1079, message: 'Refreshing', retryAfterSecs: 0 })
      .mockResolvedValueOnce({ shared_with: [] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });

    await waitFor(() => expect(result.current.people).toEqual([]));
    expect(mockGetShareDetail).toHaveBeenCalledTimes(3);
    expect(mockInvalidateShareDetailCache).toHaveBeenCalledTimes(2);
  });

  it('filters an in-flight pre-revoke response but allows a later re-share', async () => {
    let resolveStaleResponse: ((value: { shared_with: IPeopleWithAccessType[] }) => void) | undefined;

    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleResponse = resolve;
          })
      )
      .mockResolvedValueOnce({ shared_with: [removedPerson] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    act(() => {
      void result.current.loadPeople();
    });
    await waitFor(() => expect(resolveStaleResponse).toBeDefined());

    act(() => {
      result.current.removePersonFromAccessList(removedPerson.email);
    });
    expect(result.current.people).toEqual([]);

    act(() => resolveStaleResponse?.({ shared_with: [removedPerson] }));
    await waitFor(() => expect(mockGetShareDetail).toHaveBeenCalledTimes(2));
    expect(result.current.people).toEqual([]);

    // A request started after the revoke/cache invalidation is authoritative;
    // if it contains the email, another client has legitimately re-shared it.
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });
    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));
    expect(mockGetShareDetail).toHaveBeenCalledTimes(3);
  });

  it('ignores share notifications for unrelated views', async () => {
    mockGetShareDetail.mockResolvedValueOnce({ shared_with: [removedPerson] });

    const { result } = renderHook(() => useShareAccessDetails('view-1', true));

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));

    await act(async () => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'unrelated-view' });
      await Promise.resolve();
    });

    expect(mockGetShareDetail).toHaveBeenCalledTimes(1);
    expect(mockInvalidateShareDetailCache).not.toHaveBeenCalled();
  });

  it('aborts an event-triggered refresh when the share panel closes', async () => {
    let notificationSignal: AbortSignal | undefined;

    mockGetShareDetail
      .mockResolvedValueOnce({ shared_with: [removedPerson] })
      .mockImplementationOnce(
        (_workspaceId: string, _viewId: string, _ancestorViewIds: string[], signal: AbortSignal) =>
          new Promise((resolve) => {
            notificationSignal = signal;
            signal.addEventListener('abort', () => resolve({ shared_with: [] }), { once: true });
          })
      );

    const { result, rerender } = renderHook(({ opened }) => useShareAccessDetails('view-1', opened), {
      initialProps: { opened: true },
    });

    await waitFor(() => expect(result.current.people).toEqual([removedPerson]));
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'view-1' });
    });
    await waitFor(() => expect(notificationSignal).toBeDefined());

    rerender({ opened: false });

    expect(notificationSignal?.aborted).toBe(true);
  });
});
