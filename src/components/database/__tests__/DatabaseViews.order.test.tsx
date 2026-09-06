import { expect } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { type ReorderResult } from '@/components/_shared/reorder/useReorderMonitor';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

type CapturedDatabaseTabsProps = {
  viewIds: string[];
  setSelectedViewId?: (viewId: string) => void;
  onBeforeViewAddedToDatabase?: () => void;
  onViewAddedToDatabase?: (viewId: string) => void;
  onAfterViewAddedToDatabase?: () => void;
  onReorderTabs?: (result: ReorderResult) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var __databaseViewsOrderTestState:
    | {
        renderedViewIds: string[][];
        latestTabsProps?: CapturedDatabaseTabsProps;
        gridGroupingProviderRenderCount?: number;
        listGroupingProviderRenderCount?: number;
      }
    | undefined;
}

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/database/components/tabs', () => ({
  DatabaseTabs: (props: CapturedDatabaseTabsProps) => {
    global.__databaseViewsOrderTestState = {
      ...global.__databaseViewsOrderTestState,
      renderedViewIds: [...(global.__databaseViewsOrderTestState?.renderedViewIds ?? []), props.viewIds],
      latestTabsProps: props,
    };

    return (
      <div data-testid='database-tabs-mock'>
        {props.viewIds.map((viewId) => (
          <button key={viewId} type='button' onClick={() => props.setSelectedViewId?.(viewId)}>
            {viewId}
          </button>
        ))}
      </div>
    );
  },
}));

jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => {
    global.__databaseViewsOrderTestState = {
      ...global.__databaseViewsOrderTestState,
      renderedViewIds: global.__databaseViewsOrderTestState?.renderedViewIds ?? [],
      gridGroupingProviderRenderCount: (global.__databaseViewsOrderTestState?.gridGroupingProviderRenderCount ?? 0) + 1,
    };

    return <>{children}</>;
  },
}));

jest.mock('@/components/database/list/ListGroupingContext', () => ({
  ListGroupingProvider: ({ children }: { children: ReactNode }) => {
    global.__databaseViewsOrderTestState = {
      ...global.__databaseViewsOrderTestState,
      renderedViewIds: global.__databaseViewsOrderTestState?.renderedViewIds ?? [],
      listGroupingProviderRenderCount: (global.__databaseViewsOrderTestState?.listGroupingProviderRenderCount ?? 0) + 1,
    };

    return <>{children}</>;
  },
}));

jest.mock('@/components/database/grid', () => ({
  Grid: () => <div data-testid='grid-layout' />,
}));

jest.mock('@/components/database/board', () => ({
  Board: () => null,
}));

jest.mock('@/components/database/chart', () => ({
  Chart: () => null,
}));

jest.mock('@/components/database/fullcalendar', () => ({
  Calendar: () => null,
}));

jest.mock('@/components/database/gallery', () => ({
  __esModule: true,
  default: () => <div data-testid='gallery-layout' />,
}));

jest.mock('@/components/database/form/FormBuilderView', () => ({
  FormBuilderView: () => <div data-testid='form-builder-layout' />,
}));

jest.mock('@/components/database/DatabaseHistoryScope', () => ({
  DatabaseHistoryScope: ({ children }: { children: ReactNode }) => (
    <div data-testid='database-history-scope'>{children}</div>
  ),
}));

jest.mock('@/components/database/components/UnsupportedView', () => () => null);
jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => null);
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));
jest.mock('@/utils/log', () => ({
  Log: {
    error: jest.fn(),
  },
}));

function createDatabaseDoc(
  databaseId: string,
  viewsInInsertionOrder: Array<{
    viewId: string;
    name: string;
    createdAt: string;
    layout?: DatabaseViewLayout;
  }>
): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);

  viewsInInsertionOrder.forEach(({ viewId, name, createdAt, layout = DatabaseViewLayout.Grid }) => {
    const view = new Y.Map();

    view.set(YjsDatabaseKey.id, viewId);
    view.set(YjsDatabaseKey.name, name);
    view.set(YjsDatabaseKey.layout, layout);
    view.set(YjsDatabaseKey.created_at, createdAt);
    view.set(YjsDatabaseKey.is_inline, false);
    view.set(YjsDatabaseKey.embedded, false);
    views.set(viewId, view);
  });

  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function renderDatabaseViews({
  databaseId = 'db-1',
  visibleViewIds,
  activeViewId = visibleViewIds[0],
  onReorderViews,
}: {
  databaseId?: string;
  visibleViewIds: string[];
  activeViewId?: string;
  onReorderViews?: (movedViewId: string, prevViewId: string | null) => void | Promise<void>;
}) {
  const doc = createDatabaseDoc(databaseId, [
    { viewId: visibleViewIds[0], name: 'Launch Review Log', createdAt: '300' },
    { viewId: visibleViewIds[1], name: 'Grid', createdAt: '200' },
    { viewId: visibleViewIds[2], name: 'Grid2', createdAt: '100' },
  ]);
  const contextValue: DatabaseContextState = {
    readOnly: true,
    databaseDoc: doc,
    databasePageId: visibleViewIds[0],
    activeViewId,
    rowDocMap: {},
    workspaceId: 'workspace-id',
  };

  render(
    <DatabaseContext.Provider value={contextValue}>
      <DatabaseViews
        onChangeView={jest.fn()}
        activeViewId={activeViewId}
        databasePageId={visibleViewIds[0]}
        visibleViewIds={visibleViewIds}
        onReorderViews={onReorderViews}
      />
    </DatabaseContext.Provider>
  );
}

describe('DatabaseViews order', () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.__databaseViewsOrderTestState = undefined;
  });

  it('preserves visible view order instead of sorting container tabs by created_at', async () => {
    const visibleViewIds = ['launch-review-log', 'grid', 'grid2'];

    renderDatabaseViews({ visibleViewIds });

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.renderedViewIds.length).toBeGreaterThanOrEqual(2);
    });

    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(visibleViewIds);
  });

  it('remounts Gallery when the active Gallery view changes', async () => {
    const visibleViewIds = ['gallery-a', 'gallery-b', 'gallery-c'];
    const doc = createDatabaseDoc('gallery-db', [
      {
        viewId: 'gallery-a',
        name: 'Gallery A',
        createdAt: '100',
        layout: DatabaseViewLayout.Gallery,
      },
      {
        viewId: 'gallery-b',
        name: 'Gallery B',
        createdAt: '200',
        layout: DatabaseViewLayout.Gallery,
      },
      {
        viewId: 'gallery-c',
        name: 'Gallery C',
        createdAt: '300',
        layout: DatabaseViewLayout.Gallery,
      },
    ]);
    const renderForActiveView = (activeViewId: string) => {
      const contextValue: DatabaseContextState = {
        readOnly: true,
        databaseDoc: doc,
        databasePageId: visibleViewIds[0],
        activeViewId,
        rowDocMap: {},
        workspaceId: 'workspace-id',
      };

      return (
        <DatabaseContext.Provider value={contextValue}>
          <DatabaseViews
            activeViewId={activeViewId}
            databasePageId={visibleViewIds[0]}
            onChangeView={jest.fn()}
            visibleViewIds={visibleViewIds}
          />
        </DatabaseContext.Provider>
      );
    };

    const { rerender } = render(renderForActiveView('gallery-a'));

    const firstGalleryNode = await screen.findByTestId('gallery-layout');

    rerender(renderForActiveView('gallery-b'));

    await waitFor(() => expect(screen.getByTestId('gallery-layout')).not.toBe(firstGalleryNode));
  });

  it('overwrites stale stored order when visible view order is authoritative', async () => {
    const databaseId = 'db-1';
    const visibleViewIds = ['launch-review-log', 'grid', 'grid2'];

    window.localStorage.setItem('database_view_order:db-1', JSON.stringify(['grid2', 'launch-review-log', 'grid']));

    renderDatabaseViews({ databaseId, visibleViewIds });

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.renderedViewIds.length).toBeGreaterThanOrEqual(2);
    });

    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(visibleViewIds);
    expect(JSON.parse(window.localStorage.getItem(`database_view_order:${databaseId}`) || '[]')).toEqual(visibleViewIds);
  });

  it('optimistically appends a newly created view to the end', async () => {
    const visibleViewIds = ['launch-review-log', 'grid', 'grid2'];
    const newViewId = 'new-grid';

    renderDatabaseViews({ visibleViewIds, activeViewId: 'grid' });

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.latestTabsProps).toBeDefined();
    });

    act(() => {
      global.__databaseViewsOrderTestState?.latestTabsProps?.onBeforeViewAddedToDatabase?.();
      global.__databaseViewsOrderTestState?.latestTabsProps?.onViewAddedToDatabase?.(newViewId);
      global.__databaseViewsOrderTestState?.latestTabsProps?.onAfterViewAddedToDatabase?.();
    });

    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual([...visibleViewIds, newViewId]);
  });

  it('keeps a newly duplicated view before its source when Yjs observes the appended child', async () => {
    const visibleViewIds = ['launch-review-log', 'grid', 'grid2'];
    const newViewId = 'duplicated-grid';
    const nextIds = ['launch-review-log', newViewId, 'grid', 'grid2'];
    const doc = createDatabaseDoc('db-duplicate-order', [
      { viewId: 'launch-review-log', name: 'Launch Review Log', createdAt: '100' },
      { viewId: 'grid', name: 'Grid', createdAt: '200' },
      { viewId: 'grid2', name: 'Grid 2', createdAt: '300' },
    ]);
    const renderForVisibleViews = (nextVisibleViewIds: string[]) => {
      const contextValue: DatabaseContextState = {
        readOnly: true,
        databaseDoc: doc,
        databasePageId: 'launch-review-log',
        activeViewId: 'grid',
        rowDocMap: {},
        workspaceId: 'workspace-id',
      };

      return (
        <DatabaseContext.Provider value={contextValue}>
          <DatabaseViews
            onChangeView={jest.fn()}
            activeViewId='grid'
            databasePageId='launch-review-log'
            visibleViewIds={nextVisibleViewIds}
          />
        </DatabaseContext.Provider>
      );
    };

    const rendered = render(renderForVisibleViews(visibleViewIds));

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.latestTabsProps).toBeDefined();
    });

    act(() => {
      const tabsProps = global.__databaseViewsOrderTestState?.latestTabsProps;

      tabsProps?.onBeforeViewAddedToDatabase?.();
      tabsProps?.onViewAddedToDatabase?.(newViewId);
      tabsProps?.onReorderTabs?.({
        movedId: newViewId,
        prevId: 'launch-review-log',
        nextIds,
        fromIndex: 3,
        toIndex: 1,
      });
      tabsProps?.onAfterViewAddedToDatabase?.();
    });

    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(nextIds);

    act(() => {
      const views = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.get(YjsDatabaseKey.views);
      const duplicatedView = new Y.Map();

      duplicatedView.set(YjsDatabaseKey.id, newViewId);
      duplicatedView.set(YjsDatabaseKey.name, 'Grid (Copy)');
      duplicatedView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
      duplicatedView.set(YjsDatabaseKey.created_at, '400');
      duplicatedView.set(YjsDatabaseKey.is_inline, false);
      duplicatedView.set(YjsDatabaseKey.embedded, false);
      views?.set(newViewId, duplicatedView);
      rendered.rerender(renderForVisibleViews([...visibleViewIds, newViewId]));
    });

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(nextIds);
    });

    rendered.unmount();
    doc.destroy();
  });

  it('rolls back optimistic tab order when durable container reorder fails', async () => {
    const databaseId = 'db-1';
    const visibleViewIds = ['launch-review-log', 'grid', 'grid2'];
    const nextIds = ['grid2', 'launch-review-log', 'grid'];
    const onReorderViews = jest.fn().mockRejectedValue(new Error('move failed'));

    renderDatabaseViews({ databaseId, visibleViewIds, onReorderViews });

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.latestTabsProps).toBeDefined();
    });

    act(() => {
      global.__databaseViewsOrderTestState?.latestTabsProps?.onReorderTabs?.({
        movedId: 'grid2',
        prevId: null,
        nextIds,
        fromIndex: 2,
        toIndex: 0,
      });
    });

    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(nextIds);

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(visibleViewIds);
    });

    expect(onReorderViews).toHaveBeenCalledWith('grid2', null);
    expect(JSON.parse(window.localStorage.getItem(`database_view_order:${databaseId}`) || '[]')).toEqual(visibleViewIds);
  });

  it('does not mount Grid grouping against the next view while switching to Board', async () => {
    const visibleViewIds = ['grid', 'board', 'grid2'];
    const doc = createDatabaseDoc('db-layout-switch', [
      { viewId: 'grid', name: 'Grid', createdAt: '100', layout: DatabaseViewLayout.Grid },
      { viewId: 'board', name: 'Board', createdAt: '200', layout: DatabaseViewLayout.Board },
      { viewId: 'grid2', name: 'Grid 2', createdAt: '300', layout: DatabaseViewLayout.Grid },
    ]);
    const renderForView = (activeViewId: string) => {
      const contextValue: DatabaseContextState = {
        readOnly: true,
        databaseDoc: doc,
        databasePageId: 'grid',
        activeViewId,
        rowDocMap: {},
        workspaceId: 'workspace-id',
      };

      return (
        <DatabaseContext.Provider value={contextValue}>
          <DatabaseViews
            activeViewId={activeViewId}
            databasePageId='grid'
            onChangeView={jest.fn()}
            visibleViewIds={visibleViewIds}
          />
        </DatabaseContext.Provider>
      );
    };

    const rendered = render(renderForView('grid'));

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.gridGroupingProviderRenderCount).toBeGreaterThan(0);
    });
    if (global.__databaseViewsOrderTestState) {
      global.__databaseViewsOrderTestState.gridGroupingProviderRenderCount = 0;
    }

    rendered.rerender(renderForView('board'));

    expect(global.__databaseViewsOrderTestState?.gridGroupingProviderRenderCount).toBe(0);

    act(() => {
      doc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database)
        ?.get(YjsDatabaseKey.views)
        ?.get('board')
        ?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    });
    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.gridGroupingProviderRenderCount).toBeGreaterThan(0);
    });

    rendered.unmount();
    doc.destroy();
  });

  it('mounts one shared List grouping provider around the renderer and settings', async () => {
    const visibleViewIds = ['list', 'grid', 'grid2'];
    const doc = createDatabaseDoc('db-list-provider', [
      { viewId: 'list', name: 'List', createdAt: '100', layout: DatabaseViewLayout.List },
      { viewId: 'grid', name: 'Grid', createdAt: '200' },
      { viewId: 'grid2', name: 'Grid 2', createdAt: '300' },
    ]);
    const contextValue: DatabaseContextState = {
      readOnly: true,
      databaseDoc: doc,
      databasePageId: 'list',
      activeViewId: 'list',
      rowDocMap: {},
      workspaceId: 'workspace-id',
    };

    render(
      <DatabaseContext.Provider value={contextValue}>
        <DatabaseViews
          activeViewId='list'
          databasePageId='list'
          onChangeView={jest.fn()}
          visibleViewIds={visibleViewIds}
        />
      </DatabaseContext.Provider>
    );

    await waitFor(() => {
      expect(global.__databaseViewsOrderTestState?.listGroupingProviderRenderCount).toBeGreaterThan(0);
    });
    expect(global.__databaseViewsOrderTestState?.gridGroupingProviderRenderCount ?? 0).toBe(0);

    doc.destroy();
  });

  it('switches from the Form tab to the linked Responses Grid', async () => {
    const visibleViewIds = ['form', 'responses'];
    const doc = createDatabaseDoc('db-form-responses', [
      { viewId: 'form', name: 'Form', createdAt: '100', layout: DatabaseViewLayout.Form },
      { viewId: 'responses', name: 'Responses', createdAt: '200', layout: DatabaseViewLayout.Grid },
    ]);
    const onChangeView = jest.fn();
    const renderForActiveView = (activeViewId: string) => {
      const contextValue: DatabaseContextState = {
        readOnly: false,
        databaseDoc: doc,
        databasePageId: 'form',
        activeViewId,
        rowDocMap: {},
        workspaceId: 'workspace-id',
      };

      return (
        <DatabaseContext.Provider value={contextValue}>
          <DatabaseViews
            activeViewId={activeViewId}
            databasePageId='form'
            onChangeView={onChangeView}
            visibleViewIds={visibleViewIds}
          />
        </DatabaseContext.Provider>
      );
    };

    const rendered = render(renderForActiveView('form'));

    expect(await screen.findByTestId('form-builder-layout')).toBeTruthy();
    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(visibleViewIds);

    fireEvent.click(screen.getByRole('button', { name: 'responses' }));

    expect(onChangeView).toHaveBeenCalledWith('responses');
    rendered.rerender(renderForActiveView('responses'));

    expect(await screen.findByTestId('grid-layout')).toBeTruthy();
    expect(screen.queryByTestId('form-builder-layout')).toBeNull();
    doc.destroy();
  });

  it('keeps a legacy single-Form database inside the database history scope', async () => {
    const visibleViewIds = ['form'];
    const doc = createDatabaseDoc('db-form-history', [
      { viewId: 'form', name: 'Form', createdAt: '100', layout: DatabaseViewLayout.Form },
    ]);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: 'form',
      activeViewId: 'form',
      rowDocMap: {},
      workspaceId: 'workspace-id',
    };

    render(
      <DatabaseContext.Provider value={contextValue}>
        <DatabaseViews
          activeViewId='form'
          databasePageId='form'
          onChangeView={jest.fn()}
          visibleViewIds={visibleViewIds}
        />
      </DatabaseContext.Provider>
    );

    const formBuilder = await screen.findByTestId('form-builder-layout');

    expect(formBuilder.parentElement).toBe(screen.getByTestId('database-history-scope'));
    expect(global.__databaseViewsOrderTestState?.renderedViewIds.at(-1)).toEqual(['form']);
    doc.destroy();
  });
});
