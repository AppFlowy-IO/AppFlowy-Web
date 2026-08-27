import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';

import { PageService, ViewService } from '@/application/services/domains';
import { Role, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { Log } from '@/utils/log';

import { usePageOperations } from '../usePageOperations';

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: {
    moveToTrash: jest.fn(),
  },
  PublishService: {},
  ViewService: {
    invalidateCache: jest.fn(),
  },
}));

jest.mock('@/application/services/js-services/cache', () => ({
  deleteView: jest.fn(),
}));

jest.mock('@/application/services/js-services/cached-api', () => ({
  clearPublishViewInfoCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/publish-api', () => ({
  publishCollabs: jest.fn(),
}));

jest.mock('@/application/services/js-services/publish-database-data', () => ({
  gatherDatabasePublishData: jest.fn(),
}));

const workspaceId = 'workspace-id';

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

function Wrapper({ children }: { children: ReactNode }) {
  const authContext: AuthInternalContextType = {
    currentWorkspaceId: workspaceId,
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: {
        id: workspaceId,
        databaseStorageId: 'database-storage-id',
        role: Role.Owner,
      },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };

  return <AuthInternalContext.Provider value={authContext}>{children}</AuthInternalContext.Provider>;
}

describe('usePageOperations trash refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (PageService.moveToTrash as jest.Mock).mockResolvedValue(undefined);
  });

  it('starts exactly one centralized trash refresh after a local move to trash', async () => {
    const loadTrash = jest.fn().mockResolvedValue(undefined);
    const loadOutline = jest.fn().mockResolvedValue(undefined);
    const outlineRef = {
      current: [createView('space-id', [createView('page-id')])],
    };

    const { result } = renderHook(
      () =>
        usePageOperations({
          outlineRef,
          loadOutline,
          loadTrash,
        }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await result.current.deletePage('page-id');
    });

    expect(PageService.moveToTrash).toHaveBeenCalledWith(workspaceId, 'page-id');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'page-id');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(loadTrash).toHaveBeenCalledTimes(1);
    expect(loadTrash).toHaveBeenCalledWith(workspaceId, { ensureFreshAfterInFlight: true });
  });

  it('does not turn a background trash refresh failure into a delete failure', async () => {
    const refreshError = new Error('refresh unavailable');
    const loadTrash = jest.fn().mockRejectedValue(refreshError);
    const warn = jest.spyOn(Log, 'warn').mockImplementation(() => undefined);
    const outlineRef = {
      current: [createView('space-id', [createView('page-id')])],
    };
    const { result } = renderHook(
      () =>
        usePageOperations({
          outlineRef,
          loadTrash,
        }),
      { wrapper: Wrapper }
    );

    await expect(
      act(async () => {
        await result.current.deletePage('page-id');
      })
    ).resolves.toBeUndefined();

    await act(async () => {
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalledWith('[Trash] Failed to refresh after moving a page to trash', refreshError);
    warn.mockRestore();
  });
});
