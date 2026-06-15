import { expect } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';

import AppPage from '../AppPage';

declare global {
  // eslint-disable-next-line no-var
  var __appPageTestState: {
    viewId?: string;
    workspaceId?: string;
    outline?: View[];
    handlers?: Record<string, unknown>;
    getAppViewCached?: (workspaceId: string, viewId: string) => Promise<View>;
  } | undefined;
}

jest.mock('@/components/app/app.hooks', () => {
  return {
    useAppViewId: () => global.__appPageTestState?.viewId,
    useAIEnabled: () => true,
    useCurrentWorkspaceId: () => global.__appPageTestState?.workspaceId,
    useAppOutline: () => global.__appPageTestState?.outline,
    useAppOperations: () => global.__appPageTestState?.handlers ?? {},
    useAppRendered: () => false,
    useAppendBreadcrumb: () => global.__appPageTestState?.handlers?.appendBreadcrumb ?? jest.fn(),
    useOnRendered: () => global.__appPageTestState?.handlers?.onRendered ?? jest.fn(),
    useOpenPageModal: () => global.__appPageTestState?.handlers?.openPageModal ?? jest.fn(),
    useLoadViews: () => global.__appPageTestState?.handlers?.loadViews ?? jest.fn(),
    useEventEmitter: () => global.__appPageTestState?.handlers?.eventEmitter,
    useGetMentionUser: () => jest.fn(),
    useLoadDatabaseRelations: () => jest.fn(),
    useScheduleDeferredCleanup: () => jest.fn(),
  };
});

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  getViewReadOnlyStatus: () => false,
  useViewOperations: () => ({
    getViewReadOnlyStatus: () => false,
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'test@appflowy.io' }),
}));

jest.mock('@/application/services/js-services/cached-api', () => ({
  getAppViewCached: (...args: unknown[]) => global.__appPageTestState?.getAppViewCached?.(...(args as [string, string])),
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: () => null,
}));

jest.mock('@/components/app/DatabaseView', () => () => null);
jest.mock('@/components/document', () => ({ Document: () => null }));
jest.mock('@/components/ai-chat', () => ({ AIChat: () => null }));
jest.mock('@/components/_shared/help/Help', () => () => null);
jest.mock('@/components/error/RecordNotFound', () => () => null);
jest.mock('@/components/_shared/helmet/ViewHelmet', () => () => null);

describe('AppPage database container', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('navigates to first child when opening a database container', async () => {
    const toView = jest.fn().mockResolvedValue(undefined);
    const loadView = jest.fn().mockResolvedValue({ guid: 'db' });

    const childView: View = {
      view_id: 'child-view-id',
      name: 'Grid View',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
    };

    const containerView: View = {
      view_id: 'container-view-id',
      name: 'Database Container',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [childView],
      is_published: false,
      is_private: false,
    };

    global.__appPageTestState = {
      viewId: containerView.view_id,
      workspaceId: 'workspace-id',
      outline: [containerView],
      handlers: {
        toView,
        loadViewMeta: jest.fn(),
        createRow: jest.fn(),
        loadView,
        appendBreadcrumb: jest.fn(),
        onRendered: jest.fn(),
        updatePage: jest.fn(),
        addPage: jest.fn(),
        deletePage: jest.fn(),
        openPageModal: jest.fn(),
        loadViews: jest.fn(),
        setWordCount: jest.fn(),
        uploadFile: jest.fn(),
        eventEmitter: undefined,
      },
    };

    render(
      <AppPage />
    );

    await waitFor(() => {
      expect(toView).toHaveBeenCalledWith(childView.view_id, undefined, true);
    });

    expect(loadView).not.toHaveBeenCalled();
  });

  it('navigates to first child even when outline is missing (fallback fetch)', async () => {
    const toView = jest.fn().mockResolvedValue(undefined);
    const loadView = jest.fn().mockResolvedValue({ guid: 'db' });

    const childView: View = {
      view_id: 'child-view-id',
      name: 'Grid View',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false },
      children: [],
      is_published: false,
      is_private: false,
    };

    const containerView: View = {
      view_id: 'container-view-id',
      name: 'Database Container',
      icon: null,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true },
      children: [childView],
      is_published: false,
      is_private: false,
    };

    const getAppView = jest.fn().mockResolvedValue(containerView);

    global.__appPageTestState = {
      viewId: containerView.view_id,
      workspaceId: 'workspace-id',
      outline: undefined,
      getAppViewCached: getAppView,
      handlers: {
        toView,
        loadViewMeta: jest.fn(),
        createRow: jest.fn(),
        loadView,
        appendBreadcrumb: jest.fn(),
        onRendered: jest.fn(),
        updatePage: jest.fn(),
        addPage: jest.fn(),
        deletePage: jest.fn(),
        openPageModal: jest.fn(),
        loadViews: jest.fn(),
        setWordCount: jest.fn(),
        uploadFile: jest.fn(),
        eventEmitter: undefined,
      },
    };

    render(
      <AppPage />
    );

    await waitFor(() => {
      expect(getAppView).toHaveBeenCalledWith('workspace-id', containerView.view_id);
      expect(toView).toHaveBeenCalledWith(childView.view_id, undefined, true);
    });

    expect(loadView).not.toHaveBeenCalled();
  });
});
