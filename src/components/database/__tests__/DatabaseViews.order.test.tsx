import { expect } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import DatabaseViews from '@/components/database/DatabaseViews';

type CapturedDatabaseTabsProps = {
  viewIds: string[];
  onBeforeViewAddedToDatabase?: () => void;
  onViewAddedToDatabase?: (viewId: string) => void;
  onAfterViewAddedToDatabase?: () => void;
};

declare global {
  // eslint-disable-next-line no-var
  var __databaseViewsOrderTestState:
    | {
        renderedViewIds: string[][];
        latestTabsProps?: CapturedDatabaseTabsProps;
      }
    | undefined;
}

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/database/components/tabs', () => ({
  DatabaseTabs: (props: CapturedDatabaseTabsProps) => {
    global.__databaseViewsOrderTestState = {
      renderedViewIds: [...(global.__databaseViewsOrderTestState?.renderedViewIds ?? []), props.viewIds],
      latestTabsProps: props,
    };

    return null;
  },
}));

jest.mock('@/components/database/grid', () => ({
  Grid: () => null,
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

jest.mock('@/components/database/components/UnsupportedView', () => () => null);
jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => null);

function createDatabaseDoc(
  databaseId: string,
  viewsInInsertionOrder: Array<{ viewId: string; name: string; createdAt: string }>
): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);

  viewsInInsertionOrder.forEach(({ viewId, name, createdAt }) => {
    const view = new Y.Map();

    view.set(YjsDatabaseKey.id, viewId);
    view.set(YjsDatabaseKey.name, name);
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
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
}: {
  databaseId?: string;
  visibleViewIds: string[];
  activeViewId?: string;
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
});
