import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';

import { PageService, ViewService } from '@/application/services/domains';
import { AccessLevel, Role, View, ViewLayout } from '@/application/types';
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
let mockRole = Role.Owner;

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
        role: mockRole,
      },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };

  return <AuthInternalContext.Provider value={authContext}>{children}</AuthInternalContext.Provider>;
}

function renderSharedDeletion(role = Role.Member) {
  mockRole = role;
  const child = { ...createView('shared-child'), parent_view_id: 'shared-page', access_level: AccessLevel.FullAccess };
  const sharedPage = {
    ...createView('shared-page', [child]),
    parent_view_id: workspaceId,
    access_level: AccessLevel.FullAccess,
  };
  // The inaccessible private space is absent; the page is projected beneath
  // the synthetic Shared with me root without changing its actual identity.
  const outlineRef = {
    current: [{ ...createView(workspaceId, [sharedPage]), extra: { is_space: true, is_hidden_space: true } }],
  };
  const loadOutline = jest.fn().mockResolvedValue(undefined);
  const loadTrash = jest.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() => usePageOperations({ outlineRef, loadOutline, loadTrash }), { wrapper: Wrapper });

  return { ...rendered, loadOutline, loadTrash };
}

describe('usePageOperations trash refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = Role.Owner;
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

  it.each([
    ['shared-page', workspaceId],
    ['shared-child', 'shared-page'],
  ])('allows a member to trash %s and refreshes the shared outline and trash', async (targetId, parentId) => {
    const { result, loadOutline, loadTrash } = renderSharedDeletion();

    await act(async () => {
      await result.current.deletePage(targetId);
    });

    expect(PageService.moveToTrash).toHaveBeenCalledTimes(1);
    expect(PageService.moveToTrash).toHaveBeenCalledWith(workspaceId, targetId);
    expect(ViewService.invalidateCache).toHaveBeenCalledTimes(2);
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, targetId);
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, parentId);
    expect(loadOutline).toHaveBeenCalledTimes(1);
    expect(loadOutline).toHaveBeenCalledWith(workspaceId, false);
    expect(loadTrash).toHaveBeenCalledTimes(1);
    expect(loadTrash).toHaveBeenCalledWith(workspaceId, { ensureFreshAfterInFlight: true });
  });

  it('keeps guest deletion denied even for a FullAccess shared page', async () => {
    const { result, loadOutline, loadTrash } = renderSharedDeletion(Role.Guest);

    await expect(result.current.deletePage('shared-page')).rejects.toThrow('Guest cannot delete pages');

    expect(PageService.moveToTrash).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
    expect(loadOutline).not.toHaveBeenCalled();
    expect(loadTrash).not.toHaveBeenCalled();
  });

  it('preserves a server permission denial without invalidating or refreshing shared content', async () => {
    const denial = Object.assign(new Error('Full access required to delete this page'), { code: 1012 });

    jest.mocked(PageService.moveToTrash).mockRejectedValueOnce(denial);
    const { result, loadOutline, loadTrash } = renderSharedDeletion();

    await expect(result.current.deletePage('shared-child')).rejects.toBe(denial);

    expect(PageService.moveToTrash).toHaveBeenCalledWith(workspaceId, 'shared-child');
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
    expect(loadOutline).not.toHaveBeenCalled();
    expect(loadTrash).not.toHaveBeenCalled();
  });

  it('does not turn background trash or outline refresh failures into a delete failure', async () => {
    const refreshError = new Error('refresh unavailable');
    const outlineError = new Error('outline unavailable');
    const loadTrash = jest.fn().mockRejectedValue(refreshError);
    const loadOutline = jest.fn().mockRejectedValue(outlineError);
    const warn = jest.spyOn(Log, 'warn').mockImplementation(() => undefined);
    const outlineRef = {
      current: [createView('space-id', [createView('page-id')])],
    };
    const { result } = renderHook(
      () =>
        usePageOperations({
          outlineRef,
          loadTrash,
          loadOutline,
        }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await expect(result.current.deletePage('page-id')).resolves.toBeUndefined();
    });
    expect(warn).toHaveBeenCalledWith('[Trash] Failed to refresh after moving a page to trash', refreshError);
    expect(warn).toHaveBeenCalledWith(expect.any(String), outlineError);
    warn.mockRestore();
  });
});
