import { act, renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';

import { PublishService } from '@/application/services/domains';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { gatherDatabasePublishData } from '@/application/services/js-services/publish-database-data';
import { publishCollabs } from '@/application/services/js-services/http/publish-api';
import { View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

import { usePageOperations } from '../usePageOperations';

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: {},
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
});
