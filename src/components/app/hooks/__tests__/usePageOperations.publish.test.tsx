import { act, renderHook } from '@testing-library/react';

import { PageService, PublishService } from '@/application/services/domains';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { publishCollabs } from '@/application/services/js-services/http/publish-api';
import { gatherDatabasePublishData } from '@/application/services/js-services/publish-database-data';
import { View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

import { usePageOperations } from '../usePageOperations';

import type { MutableRefObject } from 'react';

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: {
    add: jest.fn(),
  },
  PublishService: {
    publish: jest.fn(),
    unpublish: jest.fn(),
  },
  ViewService: {},
}));

jest.mock('@/application/services/js-services/cached-api', () => ({
  clearPublishViewInfoCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/publish-database-data', () => ({
  gatherDatabasePublishData: jest.fn(async () => new Uint8Array([1, 2, 3])),
}));

jest.mock('@/application/services/js-services/http/publish-api', () => ({
  publishCollabs: jest.fn(async () => undefined),
}));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
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

function renderUsePageOperations(options?: {
  outlineRef?: MutableRefObject<View[] | undefined>;
  getDatabaseIdForViewId?: (viewId: string) => Promise<string | null | undefined>;
  flushAllSync?: () => Promise<boolean>;
  syncAllToServer?: (workspaceId: string) => Promise<void>;
}) {
  const workspaceId = 'workspace-id';
  const authContextValue: AuthInternalContextType = {
    currentWorkspaceId: workspaceId,
    isAuthenticated: true,
    onChangeWorkspace: () => Promise.resolve(),
  };
  const loadOutline = jest.fn(async () => undefined);
  const outlineRef = options?.outlineRef ?? { current: undefined };

  const rendered = renderHook(
    () =>
      usePageOperations({
        outlineRef,
        loadOutline,
        getDatabaseIdForViewId: options?.getDatabaseIdForViewId,
        flushAllSync: options?.flushAllSync,
        syncAllToServer: options?.syncAllToServer,
      }),
    {
      wrapper: ({ children }) => (
        <AuthInternalContext.Provider value={authContextValue}>{children}</AuthInternalContext.Provider>
      ),
    }
  );

  return {
    ...rendered,
    loadOutline,
    workspaceId,
  };
}

describe('usePageOperations publish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(PublishService.publish).mockResolvedValue(undefined);
  });

  it('flushes document state before server-side publishing', async () => {
    const calls: string[] = [];
    const flushAllSync = jest.fn(async () => {
      calls.push('flush');
      return true;
    });
    const syncAllToServer = jest.fn(async () => {
      calls.push('sync');
    });

    jest.mocked(PublishService.publish).mockImplementation(async () => {
      calls.push('publish');
    });

    const { result, workspaceId } = renderUsePageOperations({ flushAllSync, syncAllToServer });

    await act(async () => {
      await result.current.publish(createView({ view_id: 'document-view-id' }));
    });

    expect(flushAllSync).toHaveBeenCalledTimes(1);
    expect(syncAllToServer).not.toHaveBeenCalled();
    expect(PublishService.publish).toHaveBeenCalledWith(workspaceId, 'document-view-id', {
      publish_name: undefined,
      visible_database_view_ids: undefined,
    });
    expect(calls).toEqual(['flush', 'publish']);
  });

  it('uses full HTTP sync when the document outbox does not drain', async () => {
    const flushAllSync = jest.fn(async () => false);
    const syncAllToServer = jest.fn(async () => undefined);
    const { result, workspaceId } = renderUsePageOperations({ flushAllSync, syncAllToServer });

    await act(async () => {
      await result.current.publish(createView({ view_id: 'document-view-id' }));
    });

    expect(flushAllSync).toHaveBeenCalledTimes(1);
    expect(syncAllToServer).toHaveBeenCalledWith(workspaceId);
    expect(PublishService.publish).toHaveBeenCalledTimes(1);
  });

  it('retries document publishing while the folder projection is pending', async () => {
    jest.useFakeTimers();

    const syncAllToServer = jest.fn(async () => undefined);

    jest
      .mocked(PublishService.publish)
      .mockRejectedValueOnce({ code: -2, message: 'Record not found: view is not projected yet' })
      .mockResolvedValueOnce(undefined);

    try {
      const { result, workspaceId } = renderUsePageOperations({ syncAllToServer });

      await act(async () => {
        const publishPromise = result.current.publish(createView({ view_id: 'document-view-id' }));

        await jest.advanceTimersByTimeAsync(250);
        await publishPromise;
      });

      expect(PublishService.publish).toHaveBeenCalledTimes(2);
      expect(syncAllToServer).toHaveBeenCalledTimes(1);
      expect(syncAllToServer).toHaveBeenCalledWith(workspaceId);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reuses the same full sync across repeated folder projection retries', async () => {
    jest.useFakeTimers();
    const syncAllToServer = jest.fn(async () => undefined);

    jest
      .mocked(PublishService.publish)
      .mockRejectedValueOnce({ code: -2, message: 'Record not exist in db' })
      .mockRejectedValueOnce({ code: -2, message: 'Record not exist in db' })
      .mockResolvedValueOnce(undefined);

    try {
      const { result } = renderUsePageOperations({ syncAllToServer });

      await act(async () => {
        const publishPromise = result.current.publish(createView({ view_id: 'document-view-id' }));

        await jest.advanceTimersByTimeAsync(750);
        await publishPromise;
      });

      expect(PublishService.publish).toHaveBeenCalledTimes(3);
      expect(syncAllToServer).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry non-projection publish failures', async () => {
    const publishError = { code: -3, message: 'Not enough permissions' };

    jest.mocked(PublishService.publish).mockRejectedValueOnce(publishError);
    const { result } = renderUsePageOperations();

    await act(async () => {
      await expect(result.current.publish(createView({ view_id: 'document-view-id' }))).rejects.toBe(publishError);
    });

    expect(PublishService.publish).toHaveBeenCalledTimes(1);
  });

  it('resolves canonical database id before publishing legacy database views', async () => {
    const viewId = 'grid-view-id';
    const databaseId = 'canonical-database-id';
    const getDatabaseIdForViewId = jest.fn(async () => databaseId);
    const { result } = renderUsePageOperations({ getDatabaseIdForViewId });

    await act(async () => {
      await result.current.publish(
        createView({
          view_id: viewId,
          name: 'Legacy Grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false },
        })
      );
    });

    expect(getDatabaseIdForViewId).toHaveBeenCalledWith(viewId);
    expect(gatherDatabasePublishData).toHaveBeenCalledWith(viewId, undefined, databaseId);
    expect(publishCollabs).toHaveBeenCalledTimes(1);
    expect(clearPublishViewInfoCache).toHaveBeenCalledWith(viewId);
    expect(PublishService.publish).not.toHaveBeenCalled();
  });

  it('uses database id from view metadata without workspace mapping lookup', async () => {
    const viewId = 'grid-view-id';
    const databaseId = 'metadata-database-id';
    const getDatabaseIdForViewId = jest.fn(async () => 'mapping-database-id');
    const { result } = renderUsePageOperations({ getDatabaseIdForViewId });

    await act(async () => {
      await result.current.publish(
        createView({
          view_id: viewId,
          name: 'Grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: databaseId },
        })
      );
    });

    expect(getDatabaseIdForViewId).not.toHaveBeenCalled();
    expect(gatherDatabasePublishData).toHaveBeenCalledWith(viewId, undefined, databaseId);
  });

  it('publishes Chart views through the client-side database endpoint', async () => {
    const viewId = 'chart-view-id';
    const databaseId = 'chart-database-id';
    const { result } = renderUsePageOperations();

    await act(async () => {
      await result.current.publish(
        createView({
          view_id: viewId,
          name: 'Chart',
          layout: ViewLayout.Chart,
          extra: { is_space: false, database_id: databaseId },
        })
      );
    });

    expect(gatherDatabasePublishData).toHaveBeenCalledWith(viewId, undefined, databaseId);
    expect(publishCollabs).toHaveBeenCalledTimes(1);
    expect(PublishService.publish).not.toHaveBeenCalled();
  });

  it('publishes metadata for visible database views under a database container', async () => {
    const containerViewId = 'database-container-id';
    const gridViewId = 'grid-view-id';
    const boardViewId = 'board-view-id';
    const calendarViewId = 'calendar-view-id';
    const databaseId = 'database-id';
    const gridView = createView({
      view_id: gridViewId,
      name: 'Grid',
      layout: ViewLayout.Grid,
      extra: { is_space: false, database_id: databaseId },
    });
    const boardView = createView({
      view_id: boardViewId,
      name: 'Board',
      layout: ViewLayout.Board,
      extra: { is_space: false, database_id: databaseId },
    });
    const calendarView = createView({
      view_id: calendarViewId,
      name: 'Calendar',
      layout: ViewLayout.Calendar,
      extra: { is_space: false, database_id: databaseId },
    });
    const containerView = createView({
      view_id: containerViewId,
      name: 'Publish database',
      layout: ViewLayout.Grid,
      extra: { is_space: false, database_id: databaseId, is_database_container: true },
      children: [gridView, boardView, calendarView],
    });
    const { result, workspaceId } = renderUsePageOperations();

    await act(async () => {
      await result.current.publish(containerView, undefined, [containerViewId, calendarViewId, boardViewId, gridViewId]);
    });

    expect(gatherDatabasePublishData).toHaveBeenCalledWith(
      containerViewId,
      [containerViewId, gridViewId, boardViewId, calendarViewId],
      databaseId
    );
    expect(publishCollabs).toHaveBeenCalledWith(workspaceId, [
      expect.objectContaining({
        meta: expect.objectContaining({
          view_id: containerViewId,
          metadata: expect.objectContaining({
            child_views: [
              expect.objectContaining({
                view_id: gridViewId,
                name: 'Grid',
                layout: ViewLayout.Grid,
              }),
              expect.objectContaining({
                view_id: boardViewId,
                name: 'Board',
                layout: ViewLayout.Board,
              }),
              expect.objectContaining({
                view_id: calendarViewId,
                name: 'Calendar',
                layout: ViewLayout.Calendar,
              }),
            ],
          }),
        }),
      }),
    ]);
  });

  it('publishes a database child view using its container view order', async () => {
    const databaseId = 'database-id';
    const gridView = createView({
      view_id: 'grid-view-id',
      name: 'Grid',
      layout: ViewLayout.Grid,
      extra: { is_space: false, database_id: databaseId },
    });
    const boardView = createView({
      view_id: 'board-view-id',
      name: 'Board',
      layout: ViewLayout.Board,
      extra: { is_space: false, database_id: databaseId },
    });
    const calendarView = createView({
      view_id: 'calendar-view-id',
      name: 'Calendar',
      layout: ViewLayout.Calendar,
      extra: { is_space: false, database_id: databaseId },
    });
    const containerView = createView({
      view_id: 'database-container-id',
      name: 'Publish database',
      layout: ViewLayout.Grid,
      extra: { is_space: false, database_id: databaseId, is_database_container: true },
      children: [gridView, boardView, calendarView],
    });
    const spaceView = createView({
      view_id: 'space-id',
      name: 'General',
      extra: { is_space: true },
      children: [containerView],
    });
    const { result } = renderUsePageOperations({ outlineRef: { current: [spaceView] } });

    await act(async () => {
      await result.current.publish(boardView, undefined, [calendarView.view_id, boardView.view_id, gridView.view_id]);
    });

    expect(gatherDatabasePublishData).toHaveBeenCalledWith(
      boardView.view_id,
      [gridView.view_id, boardView.view_id, calendarView.view_id],
      databaseId
    );
  });
});

describe('usePageOperations addPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not refresh the sidebar outline when creation fails', async () => {
    const createError = new Error('create failed');

    jest.mocked(PageService.add).mockRejectedValueOnce(createError);
    const { result, loadOutline } = renderUsePageOperations();

    await act(async () => {
      await expect(
        result.current.addPage('parent-view-id', {
          layout: ViewLayout.AIChat,
          name: 'New chat',
        })
      ).rejects.toBe(createError);
    });

    expect(loadOutline).not.toHaveBeenCalled();
  });
});
