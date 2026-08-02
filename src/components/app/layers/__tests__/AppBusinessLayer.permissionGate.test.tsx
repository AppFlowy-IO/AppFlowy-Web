import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext, type MutableRefObject, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { AccessService, ViewService } from '@/application/services/domains';
import { getTokenParsed } from '@/application/session/token';
import { Types, type View, ViewLayout } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { useAuthInternal } from '@/components/app/contexts/AuthInternalContext';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import { useDatabaseOperations } from '@/components/app/hooks/useDatabaseOperations';
import { usePageOperations } from '@/components/app/hooks/usePageOperations';
import { useRowOperations } from '@/components/app/hooks/useRowOperations';
import { useViewOperations } from '@/components/app/hooks/useViewOperations';
import { useWorkspaceData } from '@/components/app/hooks/useWorkspaceData';

import { AppBusinessLayer } from '../AppBusinessLayer';

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
}));

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getObjectPermission: jest.fn(),
  },
  ViewService: {
    get: jest.fn(),
    getCached: jest.fn(),
    getCachedFromDisk: jest.fn(),
    invalidateCache: jest.fn(),
  },
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

jest.mock('@/components/app/components/AppContextConsumer', () => ({
  AppContextConsumer: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/components/app/contexts/AuthInternalContext', () => ({
  useAuthInternal: jest.fn(),
}));

jest.mock('@/components/app/contexts/SyncInternalContext', () => ({
  useSyncInternal: jest.fn(),
}));

jest.mock('@/components/app/hooks/useDatabaseOperations', () => ({
  useDatabaseOperations: jest.fn(),
}));

jest.mock('@/components/app/hooks/usePageOperations', () => ({
  usePageOperations: jest.fn(),
}));

jest.mock('@/components/app/hooks/useRowOperations', () => ({
  useRowOperations: jest.fn(),
}));

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  useViewOperations: jest.fn(),
}));

jest.mock('@/components/app/hooks/useWorkspaceData', () => ({
  useWorkspaceData: jest.fn(),
}));

const workspaceId = '00000000-0000-4000-8000-000000000000';
const routeViewId = '00000000-0000-4000-8000-000000000001';
const modalViewId = '00000000-0000-4000-8000-000000000002';
const parentViewId = '00000000-0000-4000-8000-000000000003';

function createView(viewId: string, children: View[] = []): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children,
    is_published: false,
    is_private: false,
  };
}

function NavigationProbe({ modalTargetId }: { modalTargetId: string }) {
  const navigation = useContext(AppNavigationContext);

  if (!navigation) throw new Error('Missing navigation context');

  return (
    <>
      <button type={'button'} onClick={() => navigation.openPageModal?.(modalTargetId)}>
        open modal
      </button>
      <span data-testid={'modal-view-id'}>{navigation.openPageModalViewId ?? ''}</span>
      <span data-testid={'no-access'}>{String(navigation.viewNoAccess)}</span>
    </>
  );
}

function renderBusinessLayer(eventEmitter: EventEmitter, outline: View[], modalTargetId = modalViewId) {
  const stableOutlineRef = { current: outline } as MutableRefObject<View[]>;

  (useWorkspaceData as jest.Mock).mockReturnValue({
    outline,
    favoriteViews: [],
    recentViews: [],
    trashList: [],
    workspaceDatabases: {},
    stableOutlineRef,
    loadedViewIds: new Set<string>(),
  });
  (useSyncInternal as jest.Mock).mockReturnValue({
    eventEmitter,
    awarenessMap: {},
    flushAllSync: jest.fn(),
    revertCollabVersion: jest.fn(),
    scheduleDeferredCleanup: jest.fn(),
    syncAllToServer: jest.fn(),
  });

  return render(
    <MemoryRouter initialEntries={[`/${routeViewId}`]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route
          path={'/:viewId'}
          element={
            <AppBusinessLayer>
              <NavigationProbe modalTargetId={modalTargetId} />
            </AppBusinessLayer>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('AppBusinessLayer permission gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (getTokenParsed as jest.Mock).mockReturnValue({ user: { id: 'requester-id' } });
    (useAuthInternal as jest.Mock).mockReturnValue({
      currentWorkspaceId: workspaceId,
      isAuthenticated: true,
      onChangeWorkspace: jest.fn(),
      userWorkspaceInfo: { userId: 'requester-id' },
    });
    (useDatabaseOperations as jest.Mock).mockReturnValue({});
    (usePageOperations as jest.Mock).mockReturnValue({});
    (useRowOperations as jest.Mock).mockReturnValue({});
    (useViewOperations as jest.Mock).mockReturnValue({ awarenessMap: {} });
    (ViewService.getCached as jest.Mock).mockReturnValue(undefined);
    (ViewService.getCachedFromDisk as jest.Mock).mockResolvedValue(undefined);
    (deleteCollabDB as jest.Mock).mockResolvedValue(undefined);
  });

  it('probes and closes a denied modal whose view differs from the route', async () => {
    const eventEmitter = new EventEmitter();
    const routeView = createView(routeViewId);
    const modalView = createView(modalViewId);

    (AccessService.getObjectPermission as jest.Mock).mockImplementation((_workspaceId: string, objectId: string) =>
      Promise.resolve({ can_read: objectId !== modalViewId })
    );
    renderBusinessLayer(eventEmitter, [routeView, modalView]);

    await waitFor(() => {
      expect(AccessService.getObjectPermission).toHaveBeenCalledWith(workspaceId, routeViewId, Types.Document);
    });

    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));

    await waitFor(() => {
      expect(AccessService.getObjectPermission).toHaveBeenCalledWith(workspaceId, modalViewId, Types.Document);
      expect(screen.getByTestId('modal-view-id').textContent).toBe('');
    });
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(deleteCollabDB).toHaveBeenCalledWith(modalViewId, { destroyDoc: true });
    expect(screen.getByTestId('no-access').textContent).toBe('false');
  });

  it('closes an exactly revoked modal even when it has the route view id', async () => {
    const eventEmitter = new EventEmitter();

    (AccessService.getObjectPermission as jest.Mock).mockResolvedValue({ can_read: true });
    renderBusinessLayer(eventEmitter, [createView(routeViewId)], routeViewId);

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));
    expect(screen.getByTestId('modal-view-id').textContent).toBe(routeViewId);

    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: routeViewId });
    });

    await waitFor(() => {
      expect(screen.getByTestId('modal-view-id').textContent).toBe('');
      expect(screen.getByTestId('no-access').textContent).toBe('true');
    });
  });

  it('discards the active child TTL verdict and re-probes after an ancestor access change', async () => {
    const eventEmitter = new EventEmitter();
    const childView = createView(routeViewId);

    (AccessService.getObjectPermission as jest.Mock)
      .mockResolvedValueOnce({ can_read: true })
      .mockResolvedValueOnce({ can_read: false });
    renderBusinessLayer(eventEmitter, [createView(parentViewId, [childView])]);

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('no-access').textContent).toBe('false');

    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: parentViewId });
    });

    await waitFor(() => {
      expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('no-access').textContent).toBe('true');
    });
    expect(AccessService.getObjectPermission).toHaveBeenLastCalledWith(workspaceId, routeViewId, Types.Document);
    expect(deleteCollabDB).toHaveBeenCalledWith(routeViewId, { destroyDoc: true });
  });

  // A guest holds view-level access without workspace membership, so the
  // workspace-scoped view endpoint 403s while the object-permission API still
  // grants read. Resolving the probe target must not turn that into a denial.
  it.each([{ code: 403 }, { code: 1012 }])(
    'allows a shared view when metadata resolution fails with %p but permission grants read',
    async (metadataError) => {
      const eventEmitter = new EventEmitter();

      (ViewService.get as jest.Mock).mockRejectedValue(metadataError);
      (AccessService.getObjectPermission as jest.Mock).mockResolvedValue({ can_read: true });

      // Empty outline: the shared page has not been folded into the guest's
      // outline yet, which is what forces the network metadata lookup.
      renderBusinessLayer(eventEmitter, []);

      await waitFor(() => {
        expect(AccessService.getObjectPermission).toHaveBeenCalledWith(workspaceId, routeViewId, Types.Document);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId('no-access').textContent).toBe('false');
      expect(deleteCollabDB).not.toHaveBeenCalled();
      expect(ViewService.invalidateCache).not.toHaveBeenCalled();
    }
  );

  it('still denies when metadata resolution fails and permission refuses read', async () => {
    const eventEmitter = new EventEmitter();

    (ViewService.get as jest.Mock).mockRejectedValue({ code: 403 });
    (AccessService.getObjectPermission as jest.Mock).mockResolvedValue({ can_read: false });

    renderBusinessLayer(eventEmitter, []);

    await waitFor(() => {
      expect(screen.getByTestId('no-access').textContent).toBe('true');
    });
    expect(deleteCollabDB).toHaveBeenCalledWith(routeViewId, { destroyDoc: true });
  });
});
