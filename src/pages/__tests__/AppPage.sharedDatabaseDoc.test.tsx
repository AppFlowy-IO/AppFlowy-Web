import { expect } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';

import { View, ViewLayout, YDoc } from '@/application/types';

import AppPage from '../AppPage';

type Listener = () => void;

/** The routed view id, as a store, so a route change re-renders the memoized page. */
const route = {
  viewId: 'grid-view',
  listeners: new Set<Listener>(),
  set(viewId: string) {
    this.viewId = viewId;
    this.listeners.forEach((listener) => listener());
  },
  subscribe(listener: Listener) {
    route.listeners.add(listener);
    return () => route.listeners.delete(listener);
  },
};

const view = (viewId: string, name: string, layout: ViewLayout): View => ({
  view_id: viewId,
  name,
  icon: null,
  layout,
  extra: { is_space: false, database_id: 'database-id' },
  children: [],
  is_published: false,
  is_private: false,
});

const OUTLINE = [view('grid-view', 'Grid', ViewLayout.Grid), view('owned-board-view', 'Board', ViewLayout.Board)];
const mockRenderedViewIds: string[] = [];

/** Every view of the database shares one Y.Doc; loadView relabels it in place (useViewOperations). */
const sharedDatabaseDoc = { guid: 'database-id', object_id: 'database-id' } as unknown as YDoc & { view_id?: string };
const loadView = jest.fn(async (viewId: string) => {
  sharedDatabaseDoc.view_id = viewId;
  return sharedDatabaseDoc;
});

jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: () => useSyncExternalStore(route.subscribe, () => route.viewId),
  useAIEnabled: () => true,
  useCurrentWorkspaceId: () => 'workspace-id',
  useAppOutline: () => OUTLINE,
  useAppOperations: () => mockOperations,
  useAppRendered: () => false,
  useAppendBreadcrumb: () => jest.fn(),
  useOnRendered: () => jest.fn(),
  useOpenPageModal: () => jest.fn(),
  useLoadViews: () => jest.fn(),
  useEventEmitter: () => undefined,
  useGetMentionUser: () => jest.fn(),
  useLoadDatabaseRelations: () => jest.fn(),
  useScheduleDeferredCleanup: () => jest.fn(),
}));

const mockOperations = {
  toView: jest.fn(),
  loadViewMeta: jest.fn(),
  createRow: jest.fn(),
  loadView: (viewId: string) => loadView(viewId),
  updatePage: jest.fn(),
  addPage: jest.fn(),
  deletePage: jest.fn(),
  setWordCount: jest.fn(),
  uploadFile: jest.fn(),
};

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  getViewReadOnlyStatus: () => false,
  getViewCanCommentStatus: () => true,
  getViewCanWriteStatus: () => true,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'test@appflowy.io' }),
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: () => null,
}));

jest.mock('@/components/app/DatabaseView', () => (props: { viewMeta: { viewId: string } }) => {
  mockRenderedViewIds.push(props.viewMeta.viewId);
  return null;
});
jest.mock('@/components/document', () => ({ Document: () => null }));
jest.mock('@/components/ai-chat', () => ({ AIChat: () => null }));
jest.mock('@/components/_shared/help/Help', () => () => null);
jest.mock('@/components/error/RecordNotFound', () => () => null);
jest.mock('@/components/_shared/helmet/ViewHelmet', () => () => null);

describe('AppPage with a database doc shared by its views', () => {
  it('shows another view of the open database although loadView hands back the same doc', async () => {
    render(<AppPage />);
    await waitFor(() => expect(mockRenderedViewIds).toContain('grid-view'));

    // "View data source" of a dashboard widget routes to the widget's own view of the same database.
    act(() => route.set('owned-board-view'));

    await waitFor(() => expect(loadView).toHaveBeenCalledWith('owned-board-view'));
    await waitFor(() => expect(mockRenderedViewIds[mockRenderedViewIds.length - 1]).toBe('owned-board-view'));
  });
});
