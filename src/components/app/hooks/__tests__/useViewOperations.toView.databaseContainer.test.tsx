import EventEmitter from 'events';

import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import { AFService } from '@/application/services/services.type';
import { View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';

import { useViewOperations } from '../useViewOperations';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

function createView(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

describe('useViewOperations.toView database container', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('navigates even when loadViewMeta rejects', async () => {
    const workspaceId = 'workspace-id';
    const targetId = 'target-id';

    const authContextValue: AuthInternalContextType = {
      service: undefined,
      currentWorkspaceId: workspaceId,
      isAuthenticated: true,
      onChangeWorkspace: () => Promise.resolve(),
    };

    const syncContextValue: SyncInternalContextType = {
      registerSyncContext: () => ({ doc: {} as never }),
      eventEmitter: new EventEmitter(),
      awarenessMap: {},
      lastUpdatedCollab: null,
    } as unknown as SyncInternalContextType;

    const loadViewMeta = jest.fn(async (_viewId: string) => {
      throw new Error('View not found');
    });

    const { result } = renderHook(() => useViewOperations(), {
      wrapper: ({ children }) => (
        <AuthInternalContext.Provider value={authContextValue}>
          <SyncInternalContext.Provider value={syncContextValue}>{children}</SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      ),
    });

    await act(async () => {
      await result.current.toView(targetId, undefined, false, loadViewMeta);
    });

    expect(loadViewMeta).toHaveBeenCalledWith(targetId);
    expect(mockNavigate).toHaveBeenCalledWith(`/app/${workspaceId}/${targetId}`);
  });

  it('redirects database containers even when loadViewMeta rejects', async () => {
    const workspaceId = 'workspace-id';
    const containerId = 'container-id';
    const firstChildId = 'first-child-id';

    const service: Partial<AFService> = {
      getAppView: jest.fn(async (_workspaceId: string, viewId: string) => {
        expect(_workspaceId).toBe(workspaceId);
        expect(viewId).toBe(containerId);

        return createView({
          view_id: containerId,
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true },
          children: [createView({ view_id: firstChildId, layout: ViewLayout.Grid, parent_view_id: containerId })],
        });
      }),
    };

    const authContextValue: AuthInternalContextType = {
      service: service as AFService,
      currentWorkspaceId: workspaceId,
      isAuthenticated: true,
      onChangeWorkspace: () => Promise.resolve(),
    };

    const syncContextValue: SyncInternalContextType = {
      registerSyncContext: () => ({ doc: {} as never }),
      eventEmitter: new EventEmitter(),
      awarenessMap: {},
      lastUpdatedCollab: null,
    } as unknown as SyncInternalContextType;

    const loadViewMeta = jest.fn(async (_viewId: string) => {
      throw new Error('View not found');
    });

    const { result } = renderHook(() => useViewOperations(), {
      wrapper: ({ children }) => (
        <AuthInternalContext.Provider value={authContextValue}>
          <SyncInternalContext.Provider value={syncContextValue}>{children}</SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      ),
    });

    await act(async () => {
      await result.current.toView(containerId, undefined, false, loadViewMeta);
    });

    expect(loadViewMeta).toHaveBeenCalledWith(containerId);
    expect(service.getAppView).toHaveBeenCalledWith(workspaceId, containerId);
    expect(mockNavigate).toHaveBeenCalledWith(`/app/${workspaceId}/${firstChildId}`);
  });

  it('navigates to first child even when container children are missing from outline meta', async () => {
    const workspaceId = 'workspace-id';
    const containerId = 'container-id';
    const firstChildId = 'first-child-id';

    const service: Partial<AFService> = {
      getAppView: jest.fn(async (_workspaceId: string, viewId: string) => {
        expect(_workspaceId).toBe(workspaceId);
        expect(viewId).toBe(containerId);

        return createView({
          view_id: containerId,
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true },
          children: [createView({ view_id: firstChildId, layout: ViewLayout.Grid, parent_view_id: containerId })],
        });
      }),
    };

    const authContextValue: AuthInternalContextType = {
      service: service as AFService,
      currentWorkspaceId: workspaceId,
      isAuthenticated: true,
      onChangeWorkspace: () => Promise.resolve(),
    };

    const syncContextValue: SyncInternalContextType = {
      registerSyncContext: () => ({ doc: {} as never }),
      eventEmitter: new EventEmitter(),
      awarenessMap: {},
      lastUpdatedCollab: null,
    } as unknown as SyncInternalContextType;

    const loadViewMeta = jest.fn(async (viewId: string) => {
      expect(viewId).toBe(containerId);

      // Simulate shallow outline/meta: container is known but children are missing.
      return createView({
        view_id: containerId,
        layout: ViewLayout.Grid,
        extra: { is_space: false, is_database_container: true },
        children: [],
      });
    });

    const { result } = renderHook(() => useViewOperations(), {
      wrapper: ({ children }) => (
        <AuthInternalContext.Provider value={authContextValue}>
          <SyncInternalContext.Provider value={syncContextValue}>{children}</SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      ),
    });

    await act(async () => {
      await result.current.toView(containerId, undefined, false, loadViewMeta);
    });

    expect(loadViewMeta).toHaveBeenCalledWith(containerId);
    expect(service.getAppView).toHaveBeenCalledWith(workspaceId, containerId);
    expect(mockNavigate).toHaveBeenCalledWith(`/app/${workspaceId}/${firstChildId}`);
  });
});
