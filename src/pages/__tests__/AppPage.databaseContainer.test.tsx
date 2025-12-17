import { expect } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import { AppContext } from '@/components/app/app.hooks';

import AppPage from '../AppPage';

declare global {
  // eslint-disable-next-line no-var
  var __appPageTestState: {
    viewId?: string;
    workspaceId?: string;
    outline?: View[];
    handlers?: Record<string, unknown>;
    service?: { getAxiosInstance?: () => unknown; getAppView?: (workspaceId: string, viewId: string) => Promise<View> };
  } | undefined;
}

jest.mock('@/components/app/app.hooks', () => {
  const React = jest.requireActual('react');

  return {
    AppContext: React.createContext({ rendered: false }),
    useAppViewId: () => global.__appPageTestState?.viewId,
    useCurrentWorkspaceId: () => global.__appPageTestState?.workspaceId,
    useAppOutline: () => global.__appPageTestState?.outline,
    useAppHandlers: () => global.__appPageTestState?.handlers,
  };
});

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  useViewOperations: () => ({
    getViewReadOnlyStatus: () => false,
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'test@appflowy.io' }),
  useService: () => global.__appPageTestState?.service ?? { getAxiosInstance: () => null },
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
        createRowDoc: jest.fn(),
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
      <AppContext.Provider value={{ rendered: false }}>
        <AppPage />
      </AppContext.Provider>
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
      service: { getAxiosInstance: () => null, getAppView },
      handlers: {
        toView,
        loadViewMeta: jest.fn(),
        createRowDoc: jest.fn(),
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
      <AppContext.Provider value={{ rendered: false }}>
        <AppPage />
      </AppContext.Provider>
    );

    await waitFor(() => {
      expect(getAppView).toHaveBeenCalledWith('workspace-id', containerView.view_id);
      expect(toView).toHaveBeenCalledWith(childView.view_id, undefined, true);
    });

    expect(loadView).not.toHaveBeenCalled();
  });
});
