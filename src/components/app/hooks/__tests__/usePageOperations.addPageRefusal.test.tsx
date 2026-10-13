import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { PageService } from '@/application/services/domains';
import { Role, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

import { usePageOperations } from '../usePageOperations';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), loading: jest.fn() } }));

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: { add: jest.fn() },
  PublishService: {},
  ViewService: { invalidateCache: jest.fn() },
}));

jest.mock('@/application/services/js-services/cache', () => ({ deleteView: jest.fn() }));
jest.mock('@/application/services/js-services/cached-api', () => ({ clearPublishViewInfoCache: jest.fn() }));
jest.mock('@/application/services/js-services/http/publish-api', () => ({ publishCollabs: jest.fn() }));
jest.mock('@/application/services/js-services/publish-database-data', () => ({ gatherDatabasePublishData: jest.fn() }));

const workspaceId = 'workspace-id';

function createView(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function renderPageOperations(role: Role) {
  const outlineRef = {
    current: [
      createView('space-id', { extra: { is_space: true } }),
      createView('shared-with-me', {
        extra: { is_space: true, is_hidden_space: true },
        children: [createView('shared-page')],
      }),
    ],
  };
  const authContext: AuthInternalContextType = {
    currentWorkspaceId: workspaceId,
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: { id: workspaceId, databaseStorageId: 'database-storage-id', role },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };

  return renderHook(() => usePageOperations({ outlineRef }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthInternalContext.Provider value={authContext}>{children}</AuthInternalContext.Provider>
    ),
  });
}

describe('usePageOperations addPage refusals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Every caller reports a failed creation itself; a second toast from here doubled the message.
  it.each([
    ['for a guest', Role.Guest, 'space-id'],
    ['under a page shared with the user', Role.Member, 'shared-page'],
  ])('refuses %s with a permission error and leaves the message to the caller', async (_case, role, parentId) => {
    const { result } = renderPageOperations(role);
    const error = await result.current
      .addPage(parentId, { layout: ViewLayout.Document, name: 'Roadmap' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'No permission to create pages' });
    expect(toast.error).not.toHaveBeenCalled();
    expect(PageService.add).not.toHaveBeenCalled();
  });
});
