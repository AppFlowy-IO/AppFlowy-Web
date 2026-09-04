import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';

import { PageService } from '@/application/services/domains';
import { Role, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE } from '@/components/app/view-actions/formDuplicateSafety';

import { usePageOperations } from '../usePageOperations';

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: {
    duplicate: jest.fn(),
  },
  PublishService: {},
  ViewService: {
    refresh: jest.fn(),
    invalidateDatabaseCatalog: jest.fn(),
    refreshWorkspaceDatabaseCatalog: jest.fn().mockResolvedValue(undefined),
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

function createView(viewId: string, layout: ViewLayout): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const authContext: AuthInternalContextType = {
    currentWorkspaceId: 'workspace-id',
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: {
        id: 'workspace-id',
        databaseStorageId: 'database-storage-id',
        role: Role.Owner,
      },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };

  return <AuthInternalContext.Provider value={authContext}>{children}</AuthInternalContext.Provider>;
}

describe('usePageOperations Form duplication guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not call generic deep duplication for a Form page', async () => {
    const form = createView('form-id', ViewLayout.Form);
    const syncAllToServer = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        usePageOperations({
          outlineRef: { current: [form] },
          syncAllToServer,
        }),
      { wrapper: Wrapper }
    );

    await expect(
      act(async () => {
        await result.current.duplicatePage(form.view_id, { includeChildren: true });
      })
    ).rejects.toThrow(FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE);

    expect(syncAllToServer).not.toHaveBeenCalled();
    expect(PageService.duplicate).not.toHaveBeenCalled();
  });
});
