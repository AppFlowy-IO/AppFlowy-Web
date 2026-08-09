import { act, renderHook } from '@testing-library/react';

import { PageService } from '@/application/services/domains';
import { Role, View } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

import { usePageOperations } from '../usePageOperations';

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: {
    copyToWorkspace: jest.fn(),
    waitForCrossWorkspaceCopy: jest.fn(),
  },
  PublishService: {},
  ViewService: {},
}));

jest.mock('@/application/services/js-services/cached-api', () => ({
  clearPublishViewInfoCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/publish-database-data', () => ({
  gatherDatabasePublishData: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/publish-api', () => ({
  publishCollabs: jest.fn(),
}));

describe('usePageOperations cross-workspace copy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('syncs local state before starting the durable source-retaining copy task', async () => {
    const workspaceId = 'source-workspace-id';
    const syncAllToServer = jest.fn().mockResolvedValue(undefined);
    const task = { job_id: 'job-id', status: 'Pending', retry_after_secs: 1 } as const;
    const result = {
      duplicated_view_id: 'copied-view-id',
      dest_workspace_id: 'destination-workspace-id',
      operation: 'cross_workspace_copy',
      source_retained: true,
      warnings: [],
    } as const;

    jest.mocked(PageService.copyToWorkspace).mockResolvedValue(task);
    jest.mocked(PageService.waitForCrossWorkspaceCopy).mockResolvedValue(result);

    const authContext: AuthInternalContextType = {
      currentWorkspaceId: workspaceId,
      isAuthenticated: true,
      onChangeWorkspace: async () => undefined,
      userWorkspaceInfo: {
        userId: 'user-id',
        selectedWorkspace: {
          id: workspaceId,
          name: 'Source',
          icon: '',
          memberCount: 1,
          databaseStorageId: 'storage-id',
          createdAt: '',
          role: Role.Owner,
        },
        workspaces: [],
      },
    };
    const rendered = renderHook(
      () =>
        usePageOperations({
          outlineRef: { current: [] as View[] },
          syncAllToServer,
        }),
      {
        wrapper: ({ children }) => (
          <AuthInternalContext.Provider value={authContext}>{children}</AuthInternalContext.Provider>
        ),
      }
    );
    const payload = {
      dest_workspace_id: 'destination-workspace-id',
      idempotency_key: 'copy-action-id',
    };

    await act(async () => {
      await expect(rendered.result.current.copyPageToWorkspace('source-view-id', payload)).resolves.toEqual(result);
    });

    expect(syncAllToServer).toHaveBeenCalledWith(workspaceId);
    expect(PageService.copyToWorkspace).toHaveBeenCalledWith(workspaceId, 'source-view-id', payload);
    expect(PageService.waitForCrossWorkspaceCopy).toHaveBeenCalledWith(workspaceId, 'source-view-id', task);
    expect(syncAllToServer.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(PageService.copyToWorkspace).mock.invocationCallOrder[0]
    );
  });
});
