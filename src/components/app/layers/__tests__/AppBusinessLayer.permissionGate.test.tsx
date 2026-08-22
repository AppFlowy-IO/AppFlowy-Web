import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext, useState, type MutableRefObject, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { AccessService, ViewService } from '@/application/services/domains';
import {
  getCachedWorkspaceViewMetadata,
  invalidateWorkspaceViewMetadata,
  resolveWorkspaceViewMetadata,
} from '@/application/services/js-services/workspace-view-metadata';
import { getTokenParsed } from '@/application/session/token';
import { AccessLevel, type CollabObjectPermission, Types, type View, ViewLayout } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
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
    refresh: jest.fn(),
    getCached: jest.fn(),
    getCachedFromDisk: jest.fn(),
    invalidateCache: jest.fn(),
  },
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

jest.mock('@/application/services/js-services/workspace-view-metadata', () => ({
  getCachedWorkspaceViewMetadata: jest.fn(),
  invalidateWorkspaceViewMetadata: jest.fn(),
  resolveWorkspaceViewMetadata: jest.fn(),
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

function createObjectPermission(
  objectId: string,
  collabType: Types = Types.Document,
  overrides: Partial<CollabObjectPermission> = {}
): CollabObjectPermission {
  return {
    object_id: objectId,
    collab_type: collabType,
    governing_view_id: objectId,
    access_level: AccessLevel.FullAccess,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: true,
    ...overrides,
  };
}

function resolveObjectPermission(overrides: Partial<CollabObjectPermission> = {}) {
  return (_workspaceId: string, objectId: string, collabType: Types = Types.Document) =>
    Promise.resolve(createObjectPermission(objectId, collabType, overrides));
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
      <span data-testid={'object-permission'}>
        {JSON.stringify(navigation.objectPermissions?.[routeViewId] ?? null)}
      </span>
    </>
  );
}

function OperationsProbe({
  targetViewId,
  authoritative = false,
  metadataOnly = false,
}: {
  targetViewId: string;
  authoritative?: boolean;
  metadataOnly?: boolean;
}) {
  const operations = useContext(AppOperationsContext);
  const [loadedName, setLoadedName] = useState('');
  const [callbackName, setCallbackName] = useState('');
  const [relations, setRelations] = useState('');
  const [childIds, setChildIds] = useState('');

  if (!operations) throw new Error('Missing operations context');

  return (
    <>
      <button
        type={'button'}
        onClick={() => {
          void operations
            .loadViewMeta(
              targetViewId,
              (view) => setCallbackName(view?.name ?? ''),
              metadataOnly ? { authoritative, metadataOnly: true } : undefined
            )
            .then((view) => {
              setLoadedName(view?.name ?? '');
              setRelations(JSON.stringify(view?.database_relations));
              setChildIds(JSON.stringify(view?.children.map((child) => child.view_id) ?? []));
            });
        }}
      >
        load metadata
      </button>
      <span data-testid={'loaded-metadata-name'}>{loadedName}</span>
      <span data-testid={'callback-metadata-name'}>{callbackName}</span>
      <span data-testid={'loaded-metadata-relations'}>{relations}</span>
      <span data-testid={'loaded-metadata-child-ids'}>{childIds}</span>
    </>
  );
}

function renderBusinessLayer(
  eventEmitter: EventEmitter,
  outline: View[],
  modalTargetId = modalViewId,
  child: ReactNode = <NavigationProbe modalTargetId={modalTargetId} />
) {
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
              {child}
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
    (getCachedWorkspaceViewMetadata as jest.Mock).mockReturnValue(undefined);
    (resolveWorkspaceViewMetadata as jest.Mock).mockImplementation(
      (_workspaceId: string, _viewId: string, loader: () => Promise<View | null | undefined>) => loader()
    );
    (deleteCollabDB as jest.Mock).mockResolvedValue(undefined);
    (AccessService.getObjectPermission as jest.Mock).mockImplementation(resolveObjectPermission());
  });

  it('exposes all canonical object capabilities to active page consumers', async () => {
    const eventEmitter = new EventEmitter();
    const permission = createObjectPermission(routeViewId, Types.Document, {
      access_level: AccessLevel.FullAccess,
      can_write: false,
      can_comment: true,
      can_share: false,
    });

    (AccessService.getObjectPermission as jest.Mock).mockResolvedValue(permission);
    renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('object-permission').textContent || 'null')).toEqual(permission);
    });
  });

  it.each([ERROR_CODE.NOT_HAS_PERMISSION, 403])(
    'treats object-permission error code %s as a definitive denial',
    async (code) => {
      const eventEmitter = new EventEmitter();

      (AccessService.getObjectPermission as jest.Mock).mockRejectedValue({ code });
      renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

      await waitFor(() => expect(screen.getByTestId('no-access').textContent).toBe('true'));
      expect(deleteCollabDB).toHaveBeenCalledWith(routeViewId, { destroyDoc: true });
    }
  );

  it.each([ERROR_CODE.NOT_LOGGED_IN, ERROR_CODE.USER_UNAUTHORIZED, 401])(
    'does not purge local data for authentication error code %s',
    async (code) => {
      const eventEmitter = new EventEmitter();

      (AccessService.getObjectPermission as jest.Mock).mockRejectedValue({ code });
      renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

      await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('no-access').textContent).toBe('false');
      expect(screen.getByTestId('object-permission').textContent).toBe('null');
      expect(deleteCollabDB).not.toHaveBeenCalled();
    }
  );

  it('retries an unknown permission result and recovers capabilities', async () => {
    const eventEmitter = new EventEmitter();
    const permission = createObjectPermission(routeViewId);

    (AccessService.getObjectPermission as jest.Mock)
      .mockRejectedValueOnce({ code: -1 })
      .mockResolvedValueOnce(permission);
    renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2), { timeout: 1500 });
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('object-permission').textContent || 'null')).toEqual(permission);
    });
    expect(deleteCollabDB).not.toHaveBeenCalled();
  });

  it('loads materialized metadata through the recursively primed flat index', async () => {
    const eventEmitter = new EventEmitter();
    const outlineView = { ...createView(modalViewId), name: 'Materialized database view' };

    (getCachedWorkspaceViewMetadata as jest.Mock).mockReturnValue(outlineView);
    renderBusinessLayer(
      eventEmitter,
      [createView(routeViewId), outlineView],
      modalViewId,
      <OperationsProbe targetViewId={modalViewId} metadataOnly />
    );

    fireEvent.click(screen.getByRole('button', { name: 'load metadata' }));

    await waitFor(() => {
      expect(screen.getByTestId('loaded-metadata-name').textContent).toBe(outlineView.name);
      expect(screen.getByTestId('callback-metadata-name').textContent).toBe(outlineView.name);
    });
    expect(getCachedWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(resolveWorkspaceViewMetadata).not.toHaveBeenCalled();
    expect((ViewService.get as jest.Mock).mock.calls.some(([, viewId]) => viewId === modalViewId)).toBe(false);
  });

  it('does not promote a stale stable-outline value after the flat permission cache was cleared', async () => {
    const eventEmitter = new EventEmitter();
    const staleOutlineView = { ...createView(modalViewId), name: 'Stale outline name' };
    const freshRemoteView = { ...createView(modalViewId), name: 'Fresh server name' };

    (getCachedWorkspaceViewMetadata as jest.Mock).mockReturnValue(undefined);
    (ViewService.get as jest.Mock).mockImplementation((_workspaceId: string, viewId: string) =>
      Promise.resolve(viewId === modalViewId ? freshRemoteView : undefined)
    );

    renderBusinessLayer(
      eventEmitter,
      [createView(routeViewId), staleOutlineView],
      modalViewId,
      <OperationsProbe targetViewId={modalViewId} metadataOnly />
    );

    fireEvent.click(screen.getByRole('button', { name: 'load metadata' }));

    await waitFor(() => {
      expect(screen.getByTestId('loaded-metadata-name').textContent).toBe(freshRemoteView.name);
    });
    expect(getCachedWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(resolveWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId, expect.any(Function));
    expect(ViewService.get).toHaveBeenCalledWith(workspaceId, modalViewId);
  });

  it('preserves immediate children for a default off-outline load and bypasses the flat resolver', async () => {
    const eventEmitter = new EventEmitter();
    const child = createView(parentViewId);
    const remoteView = { ...createView(modalViewId, [child]), name: 'Remote database container' };

    (ViewService.get as jest.Mock).mockImplementation((_workspaceId: string, viewId: string) =>
      Promise.resolve(viewId === modalViewId ? remoteView : undefined)
    );

    renderBusinessLayer(
      eventEmitter,
      [createView(routeViewId)],
      modalViewId,
      <OperationsProbe targetViewId={modalViewId} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'load metadata' }));

    await waitFor(() => {
      expect(screen.getByTestId('loaded-metadata-name').textContent).toBe(remoteView.name);
      expect(screen.getByTestId('loaded-metadata-child-ids').textContent).toBe(JSON.stringify([child.view_id]));
    });
    expect(getCachedWorkspaceViewMetadata).not.toHaveBeenCalled();
    expect(resolveWorkspaceViewMetadata).not.toHaveBeenCalled();
    expect(ViewService.get).toHaveBeenCalledWith(workspaceId, modalViewId);
  });

  it('loads metadata-only off-outline values from the global index before using the network resolver', async () => {
    const eventEmitter = new EventEmitter();
    const cachedView = { ...createView(modalViewId), name: 'Cached database view' };

    (getCachedWorkspaceViewMetadata as jest.Mock).mockImplementation((_workspaceId: string, viewId: string) =>
      viewId === modalViewId ? cachedView : undefined
    );

    renderBusinessLayer(
      eventEmitter,
      [createView(routeViewId)],
      modalViewId,
      <OperationsProbe targetViewId={modalViewId} metadataOnly />
    );

    fireEvent.click(screen.getByRole('button', { name: 'load metadata' }));

    await waitFor(() => {
      expect(screen.getByTestId('loaded-metadata-name').textContent).toBe(cachedView.name);
      expect(screen.getByTestId('callback-metadata-name').textContent).toBe(cachedView.name);
      expect(screen.getByTestId('loaded-metadata-relations').textContent).toBe('{}');
    });
    expect(getCachedWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(resolveWorkspaceViewMetadata).not.toHaveBeenCalled();
    expect((ViewService.get as jest.Mock).mock.calls.some(([, viewId]) => viewId === modalViewId)).toBe(false);
    expect(cachedView).not.toHaveProperty('database_relations');
  });

  it('uses the shared resolver for a metadata-only cache miss', async () => {
    const eventEmitter = new EventEmitter();
    const remoteView = { ...createView(modalViewId), name: 'Resolved database view' };

    (ViewService.get as jest.Mock).mockImplementation((_workspaceId: string, viewId: string) =>
      Promise.resolve(viewId === modalViewId ? remoteView : undefined)
    );

    renderBusinessLayer(
      eventEmitter,
      [createView(routeViewId)],
      modalViewId,
      <OperationsProbe targetViewId={modalViewId} metadataOnly />
    );

    fireEvent.click(screen.getByRole('button', { name: 'load metadata' }));

    await waitFor(() => {
      expect(screen.getByTestId('loaded-metadata-name').textContent).toBe(remoteView.name);
    });
    expect(getCachedWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(resolveWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId, expect.any(Function));
    expect(ViewService.get).toHaveBeenCalledWith(workspaceId, modalViewId);
  });

  it('bypasses stale outline and flat metadata for an authoritative metadata-only load', async () => {
    const eventEmitter = new EventEmitter();
    const staleOutlineView = { ...createView(modalViewId), name: 'Stale outline name' };
    const freshRemoteView = { ...createView(modalViewId), name: 'Fresh server name' };

    (getCachedWorkspaceViewMetadata as jest.Mock).mockReturnValue({
      ...staleOutlineView,
      name: 'Stale flat-cache name',
    });
    (ViewService.refresh as jest.Mock).mockImplementation((_workspaceId: string, viewId: string) =>
      Promise.resolve(viewId === modalViewId ? freshRemoteView : undefined)
    );

    renderBusinessLayer(
      eventEmitter,
      [createView(routeViewId), staleOutlineView],
      modalViewId,
      <OperationsProbe targetViewId={modalViewId} metadataOnly authoritative />
    );

    fireEvent.click(screen.getByRole('button', { name: 'load metadata' }));

    await waitFor(() => {
      expect(screen.getByTestId('loaded-metadata-name').textContent).toBe(freshRemoteView.name);
    });
    expect(getCachedWorkspaceViewMetadata).not.toHaveBeenCalled();
    expect(resolveWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId, expect.any(Function), {
      refresh: true,
    });
    expect(ViewService.get).not.toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(ViewService.refresh).toHaveBeenCalledWith(workspaceId, modalViewId);
  });

  it('probes and closes a denied modal whose view differs from the route', async () => {
    const eventEmitter = new EventEmitter();
    const routeView = createView(routeViewId);
    const modalView = createView(modalViewId);

    (AccessService.getObjectPermission as jest.Mock).mockImplementation(
      (_workspaceId: string, objectId: string, collabType: Types) =>
        Promise.resolve(createObjectPermission(objectId, collabType, { can_read: objectId !== modalViewId }))
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
    expect(invalidateWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(deleteCollabDB).toHaveBeenCalledWith(modalViewId, { destroyDoc: true });
    expect(screen.getByTestId('no-access').textContent).toBe('false');
  });

  it('closes an exactly revoked modal even when it has the route view id', async () => {
    const eventEmitter = new EventEmitter();

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
      .mockResolvedValueOnce(createObjectPermission(routeViewId))
      .mockResolvedValueOnce(createObjectPermission(routeViewId, Types.Document, { can_read: false }));
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

  it('re-probes and purges the active route after a broad permission change', async () => {
    const eventEmitter = new EventEmitter();

    (AccessService.getObjectPermission as jest.Mock)
      .mockResolvedValueOnce(createObjectPermission(routeViewId))
      .mockResolvedValueOnce(createObjectPermission(routeViewId, Types.Document, { can_read: false }));
    renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('no-access').textContent).toBe('false');

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => {
      expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('no-access').textContent).toBe('true');
    });
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, routeViewId);
    expect(deleteCollabDB).toHaveBeenCalledWith(routeViewId, { destroyDoc: true });
  });

  it('drops stale capabilities while a broad permission revalidation is pending', async () => {
    const eventEmitter = new EventEmitter();
    let resolveRevalidation!: (permission: CollabObjectPermission) => void;
    const pendingRevalidation = new Promise<CollabObjectPermission>((resolve) => {
      resolveRevalidation = resolve;
    });

    (AccessService.getObjectPermission as jest.Mock)
      .mockResolvedValueOnce(createObjectPermission(routeViewId))
      .mockReturnValueOnce(pendingRevalidation);
    renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

    await waitFor(() => expect(screen.getByTestId('object-permission').textContent).not.toBe('null'));

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('object-permission').textContent).toBe('null');

    await act(async () => {
      resolveRevalidation(createObjectPermission(routeViewId, Types.Document, { can_write: false }));
      await pendingRevalidation;
    });

    expect(JSON.parse(screen.getByTestId('object-permission').textContent || 'null')).toEqual(
      createObjectPermission(routeViewId, Types.Document, { can_write: false })
    );
  });

  it('re-probes the active route when access is restored', async () => {
    const eventEmitter = new EventEmitter();

    (AccessService.getObjectPermission as jest.Mock)
      .mockResolvedValueOnce(createObjectPermission(routeViewId, Types.Document, { can_read: false }))
      .mockResolvedValueOnce(createObjectPermission(routeViewId));
    renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

    await waitFor(() => expect(screen.getByTestId('no-access').textContent).toBe('true'));

    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: routeViewId });
    });

    await waitFor(() => {
      expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('no-access').textContent).toBe('false');
      expect(JSON.parse(screen.getByTestId('object-permission').textContent || 'null')).toEqual(
        createObjectPermission(routeViewId)
      );
    });
  });

  it('ignores an older allowed probe after a broad permission change denies the route', async () => {
    const eventEmitter = new EventEmitter();
    let resolveInitialProbe!: (permission: CollabObjectPermission) => void;
    const initialProbe = new Promise<CollabObjectPermission>((resolve) => {
      resolveInitialProbe = resolve;
    });

    (AccessService.getObjectPermission as jest.Mock)
      .mockReturnValueOnce(initialProbe)
      .mockResolvedValueOnce(createObjectPermission(routeViewId, Types.Document, { can_read: false }));
    renderBusinessLayer(eventEmitter, [createView(routeViewId)]);

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1));
    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => {
      expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('no-access').textContent).toBe('true');
    });

    await act(async () => {
      resolveInitialProbe(createObjectPermission(routeViewId));
      await initialProbe;
    });

    expect(screen.getByTestId('no-access').textContent).toBe('true');
    expect(deleteCollabDB).toHaveBeenCalledWith(routeViewId, { destroyDoc: true });
  });

  it('re-probes and closes an active modal after a broad permission change', async () => {
    const eventEmitter = new EventEmitter();
    let modalCanRead = true;

    (AccessService.getObjectPermission as jest.Mock).mockImplementation(
      (_workspaceId: string, objectId: string, collabType: Types) =>
        Promise.resolve(
          createObjectPermission(objectId, collabType, { can_read: objectId !== modalViewId || modalCanRead })
        )
    );
    renderBusinessLayer(eventEmitter, [createView(routeViewId), createView(modalViewId)]);

    await waitFor(() => expect(AccessService.getObjectPermission).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'open modal' }));
    await waitFor(() => {
      expect(
        (AccessService.getObjectPermission as jest.Mock).mock.calls.filter(([, objectId]) => objectId === modalViewId)
      ).toHaveLength(1);
      expect(screen.getByTestId('modal-view-id').textContent).toBe(modalViewId);
    });

    modalCanRead = false;
    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => {
      expect(
        (AccessService.getObjectPermission as jest.Mock).mock.calls.filter(([, objectId]) => objectId === routeViewId)
      ).toHaveLength(2);
      expect(
        (AccessService.getObjectPermission as jest.Mock).mock.calls.filter(([, objectId]) => objectId === modalViewId)
      ).toHaveLength(2);
      expect(screen.getByTestId('modal-view-id').textContent).toBe('');
    });
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, modalViewId);
    expect(deleteCollabDB).toHaveBeenCalledWith(modalViewId, { destroyDoc: true });
    expect(screen.getByTestId('no-access').textContent).toBe('false');
  });

  // A guest holds view-level access without workspace membership, so the
  // workspace-scoped view endpoint 403s while the object-permission API still
  // grants read. Resolving the probe target must not turn that into a denial.
  it.each([{ code: 403 }, { code: 1012 }])(
    'allows a shared view when metadata resolution fails with %p but permission grants read',
    async (metadataError) => {
      const eventEmitter = new EventEmitter();

      (ViewService.get as jest.Mock).mockRejectedValue(metadataError);
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
    (AccessService.getObjectPermission as jest.Mock).mockImplementation(
      resolveObjectPermission({ can_read: false })
    );

    renderBusinessLayer(eventEmitter, []);

    await waitFor(() => {
      expect(screen.getByTestId('no-access').textContent).toBe('true');
    });
    expect(deleteCollabDB).toHaveBeenCalledWith(routeViewId, { destroyDoc: true });
  });

  it('walks breadcrumb fallback ancestors once while the route view stays unresolved across outline updates', async () => {
    const eventEmitter = new EventEmitter();
    const routeView = { ...createView(routeViewId), parent_view_id: parentViewId };

    (ViewService.get as jest.Mock).mockImplementation((_workspaceId: string, id: string) =>
      id === routeViewId ? Promise.resolve(routeView) : Promise.reject({ code: 403 })
    );
    (useSyncInternal as jest.Mock).mockReturnValue({
      eventEmitter,
      awarenessMap: {},
      flushAllSync: jest.fn(),
      revertCollabVersion: jest.fn(),
      scheduleDeferredCleanup: jest.fn(),
      syncAllToServer: jest.fn(),
    });

    // Production keeps one stable ref object; only the outline array identity
    // changes across refreshes.
    const stableOutlineRef = { current: [] as View[] } as MutableRefObject<View[]>;
    const makeWorkspaceData = () => {
      const outline = [createView(modalViewId)];

      stableOutlineRef.current = outline;
      return {
        outline,
        favoriteViews: [],
        recentViews: [],
        trashList: [],
        workspaceDatabases: {},
        stableOutlineRef,
        loadedViewIds: new Set<string>(),
      };
    };

    (useWorkspaceData as jest.Mock).mockReturnValue(makeWorkspaceData());

    // Fresh elements per render — identical element references would let React
    // bail out of re-rendering the layer, hiding the outline identity change.
    const makeTree = () => (
      <MemoryRouter
        initialEntries={[`/${routeViewId}`]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route
            path={'/:viewId'}
            element={
              <AppBusinessLayer>
                <NavigationProbe modalTargetId={modalViewId} />
              </AppBusinessLayer>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(makeTree());

    const parentFetchCount = () =>
      (ViewService.get as jest.Mock).mock.calls.filter(([, id]) => id === parentViewId).length;

    await waitFor(() => {
      expect(parentFetchCount()).toBe(1);
    });

    // A new outline identity that still cannot resolve the route view must not
    // re-walk the ancestor chain — that would refire one request per ancestor
    // (including permanently denied ones) on every sidebar refresh.
    (useWorkspaceData as jest.Mock).mockReturnValue(makeWorkspaceData());
    rerender(makeTree());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(parentFetchCount()).toBe(1);
  });
});
