import { renderHook } from '@testing-library/react';
import { type MutableRefObject, type ReactNode } from 'react';
import { toast } from 'sonner';

import { PageService, ViewService } from '@/application/services/domains';
import { AccessLevel, Role, View, ViewLayout } from '@/application/types';
import { findView, findViewInShareWithMe } from '@/components/_shared/outline/utils';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { Log } from '@/utils/log';

import { usePageOperations } from '../usePageOperations';

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: { add: jest.fn(), updateName: jest.fn() },
  PublishService: {},
  ViewService: { invalidateCache: jest.fn() },
}));

jest.mock('@/application/services/js-services/cache', () => ({ deleteView: jest.fn() }));
jest.mock('@/application/services/js-services/cached-api', () => ({ clearPublishViewInfoCache: jest.fn() }));
jest.mock('@/application/services/js-services/http/publish-api', () => ({ publishCollabs: jest.fn() }));
jest.mock('@/application/services/js-services/publish-database-data', () => ({ gatherDatabasePublishData: jest.fn() }));

// Synthetic identities model the same page in canonical and shared navigation.
const WORKSPACE_ID = 'c2b2e8a3-1df1-49d1-a451-deee5b7d0b7c';
const SHARED_PAGE_ID = '7f5cd6d8-c6e8-4355-9427-a0b746f02826';
const PRIVATE_SPACE_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_PAGE_ID = '33333333-3333-4333-8333-333333333333';

function createView(overrides: Partial<View>): View {
  return {
    view_id: SHARED_PAGE_ID,
    name: 'FullAccess shared document',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: true,
    ...overrides,
  };
}

function renderWithPage(
  sharedWithMe: boolean,
  { role = Role.Member, accessLevel = AccessLevel.FullAccess }: { role?: Role; accessLevel?: AccessLevel } = {}
) {
  const parent = createView({
    access_level: accessLevel,
    parent_view_id: sharedWithMe ? WORKSPACE_ID : PRIVATE_SPACE_ID,
  });
  // With page-only access, the private space is absent from the member's
  // navigation. The directly shared page is a child of the synthetic shared root.
  const root = createView({
    view_id: sharedWithMe ? WORKSPACE_ID : PRIVATE_SPACE_ID,
    name: sharedWithMe ? 'Shared with me' : 'Accessible space',
    extra: { is_space: true, is_hidden_space: sharedWithMe },
    children: [parent],
  });
  const outlineRef: MutableRefObject<View[] | undefined> = { current: [root] };
  const loadOutline = jest.fn(async () => undefined);
  const ensureViewVisibleInOutline = jest.fn(async (viewId: string) => {
    parent.children = [createView({ view_id: viewId, name: 'Member-created subpage' })];
    return [root.view_id, parent.view_id, viewId];
  });
  const auth: AuthInternalContextType = {
    currentWorkspaceId: WORKSPACE_ID,
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: '44444444-4444-4444-8444-444444444444',
      selectedWorkspace: {
        id: WORKSPACE_ID,
        databaseStorageId: '55555555-5555-4555-8555-555555555555',
        role,
      },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthInternalContext.Provider value={auth}>{children}</AuthInternalContext.Provider>
  );
  const rendered = renderHook(() => usePageOperations({ outlineRef, ensureViewVisibleInOutline, loadOutline }), { wrapper });

  return { ...rendered, outlineRef, ensureViewVisibleInOutline, loadOutline, parent };
}

describe('workspace member creating a subpage under a shared page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(PageService.add).mockImplementation(async (_workspaceId, _parentId, _payload, activation) => {
      const response = { view_id: CHILD_PAGE_ID };

      await activation?.activate?.(response);
      return response;
    });
  });

  it.each([
    {
      description: 'with FullAccess in the normal outline (positive control)',
      sharedWithMe: false,
      accessLevel: AccessLevel.FullAccess,
    },
    {
      description: 'with FullAccess on a page-only share without access to its private space',
      sharedWithMe: true,
      accessLevel: AccessLevel.FullAccess,
    },
    {
      description: 'with write access on a page-only share without access to its private space',
      sharedWithMe: true,
      accessLevel: AccessLevel.ReadAndWrite,
    },
  ])('allows creation $description', async ({ sharedWithMe, accessLevel }) => {
    const { result, outlineRef, ensureViewVisibleInOutline, parent } = renderWithPage(sharedWithMe, { accessLevel });
    const payload = { layout: ViewLayout.Document, name: 'Member-created subpage' };

    expect(parent.access_level).toBe(accessLevel);
    expect(Boolean(findViewInShareWithMe(outlineRef.current ?? [], parent.view_id))).toBe(sharedWithMe);
    if (sharedWithMe) {
      expect(findView(outlineRef.current ?? [], PRIVATE_SPACE_ID)).toBeNull();
    }

    await expect(result.current.addPage(parent.view_id, payload)).resolves.toEqual({ view_id: CHILD_PAGE_ID });

    expect(PageService.add).toHaveBeenCalledTimes(1);
    expect(PageService.add).toHaveBeenCalledWith(WORKSPACE_ID, parent.view_id, payload, expect.any(Object));
    expect(ensureViewVisibleInOutline).toHaveBeenCalledWith(CHILD_PAGE_ID);
    expect(findView(outlineRef.current ?? [], CHILD_PAGE_ID)?.name).toBe('Member-created subpage');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(WORKSPACE_ID, parent.view_id);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps the guest creation restriction even when the shared page has FullAccess', async () => {
    const { result, ensureViewVisibleInOutline, parent } = renderWithPage(true, { role: Role.Guest });

    await expect(result.current.addPage(parent.view_id, { layout: ViewLayout.Document })).rejects.toThrow(
      'No permission to create pages'
    );

    expect(PageService.add).not.toHaveBeenCalled();
    expect(ensureViewVisibleInOutline).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
  });

  it.each([
    { description: 'read-only access', accessLevel: AccessLevel.ReadOnly },
    { description: 'revoked access while the outline still says FullAccess', accessLevel: AccessLevel.FullAccess },
  ])('preserves the server denial for $description', async ({ accessLevel }) => {
    const serverDenial = Object.assign(new Error('Not enough permissions to create a child page'), { code: 1012 });

    jest.mocked(PageService.add).mockRejectedValueOnce(serverDenial);
    const { result, ensureViewVisibleInOutline, parent } = renderWithPage(true, { accessLevel });

    await expect(result.current.addPage(parent.view_id, { layout: ViewLayout.Document })).rejects.toBe(serverDenial);

    expect(PageService.add).toHaveBeenCalledTimes(1);
    expect(ensureViewVisibleInOutline).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
    expect(parent.children).toEqual([]);
  });

  it('preserves a service failure without activating a child or invalidating the parent', async () => {
    const serviceFailure = new Error('Service unavailable');

    jest.mocked(PageService.add).mockRejectedValueOnce(serviceFailure);
    const { result, ensureViewVisibleInOutline, parent } = renderWithPage(true);

    await expect(result.current.addPage(parent.view_id, { layout: ViewLayout.Document })).rejects.toBe(serviceFailure);

    expect(PageService.add).toHaveBeenCalledTimes(1);
    expect(ensureViewVisibleInOutline).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
    expect(parent.children).toEqual([]);
  });
});

describe('renaming a page in Shared with me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(PageService.updateName).mockResolvedValue(undefined);
  });

  it.each([false, true])('refreshes the shared projection after renaming a descendant: %s', async (isDescendant) => {
    const { result, loadOutline, parent } = renderWithPage(true);
    const viewId = isDescendant ? CHILD_PAGE_ID : parent.view_id;

    if (isDescendant) {
      parent.children = [createView({ view_id: viewId, parent_view_id: parent.view_id, name: 'Untitled' })];
    }

    await expect(result.current.updatePageName(viewId, 'Named shared page')).resolves.toBeUndefined();

    expect(PageService.updateName).toHaveBeenCalledWith(WORKSPACE_ID, viewId, 'Named shared page');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(WORKSPACE_ID, viewId);
    expect(loadOutline).toHaveBeenCalledTimes(1);
    expect(loadOutline).toHaveBeenCalledWith(WORKSPACE_ID, false);
  });

  it('keeps the normal outline on its existing realtime refresh path', async () => {
    const { result, loadOutline, parent } = renderWithPage(false);

    await expect(result.current.updatePageName(parent.view_id, 'Named page')).resolves.toBeUndefined();

    expect(ViewService.invalidateCache).toHaveBeenCalledWith(WORKSPACE_ID, parent.view_id);
    expect(loadOutline).not.toHaveBeenCalled();
  });

  it('does not refresh or invalidate metadata when the rename is denied', async () => {
    const serverDenial = Object.assign(new Error('Not enough permissions to rename the page'), { code: 1012 });

    jest.mocked(PageService.updateName).mockRejectedValueOnce(serverDenial);
    const { result, loadOutline, parent } = renderWithPage(true);

    await expect(result.current.updatePageName(parent.view_id, 'Rejected name')).rejects.toBe(serverDenial);

    expect(loadOutline).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
  });

  it('does not report a committed rename as failed when the projection refresh fails', async () => {
    const refreshError = new Error('Outline unavailable');
    const warn = jest.spyOn(Log, 'warn').mockImplementation(() => undefined);

    try {
      const { result, loadOutline, parent } = renderWithPage(true);

      loadOutline.mockRejectedValueOnce(refreshError);
      await expect(result.current.updatePageName(parent.view_id, 'Saved name')).resolves.toBeUndefined();

      expect(loadOutline).toHaveBeenCalledWith(WORKSPACE_ID, false);
      expect(warn).toHaveBeenCalledWith('[Outline] Failed to refresh Shared with me after renaming a page', refreshError);
    } finally {
      warn.mockRestore();
    }
  });
});
