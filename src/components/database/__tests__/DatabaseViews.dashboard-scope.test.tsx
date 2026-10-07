import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { loadDashboard } from '@/components/database/dashboard/load';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

// The dashboard chunk resolves only when the test lets it.
jest.mock('@/components/database/dashboard/load', () => ({ loadDashboard: jest.fn() }));

// The other layouts pull in heavy dependencies (FullCalendar ships ESM) and are not used here.
jest.mock('@/components/database/board', () => ({ Board: () => null }));
jest.mock('@/components/database/chart', () => ({ Chart: () => null }));
jest.mock('@/components/database/fullcalendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/form/FormBuilderView', () => ({ FormBuilderView: () => null }));
jest.mock('@/components/database/gallery', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/grid', () => ({ Grid: () => null }));
jest.mock('@/components/database/list/List', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  DatabaseSearchProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/database/components/tabs', () => ({
  DatabaseTabs: () => <div data-testid='database-tabs' />,
}));
jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/database/list/ListGroupingContext', () => ({
  ListGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => null);
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

type DashboardChunk = Awaited<ReturnType<typeof loadDashboard>>;

const dashboardChunk = {
  default: function DashboardProbe() {
    return <div data-testid='dashboard-layout' />;
  },
  DashboardProvider: ({ children }: { children: ReactNode }) => <div data-testid='dashboard-scope'>{children}</div>,
} as unknown as DashboardChunk;

function createDatabaseDoc(layout: DatabaseViewLayout): YDoc {
  const doc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  view.set(YjsDatabaseKey.id, 'view-id');
  view.set(YjsDatabaseKey.name, 'View');
  view.set(YjsDatabaseKey.layout, layout);
  view.set(YjsDatabaseKey.created_at, '100');
  view.set(YjsDatabaseKey.is_inline, false);
  view.set(YjsDatabaseKey.embedded, false);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function renderDashboardPage() {
  const contextValue: DatabaseContextState = {
    activeViewId: 'view-id',
    databaseDoc: createDatabaseDoc(DatabaseViewLayout.Dashboard),
    databasePageId: 'view-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return render(
    <DatabaseContext.Provider value={contextValue}>
      <DatabaseViews activeViewId='view-id' databasePageId='view-id' onChangeView={jest.fn()} visibleViewIds={['view-id']} />
    </DatabaseContext.Provider>
  );
}

it('keeps the page skeleton until the dashboard chunk is in, then renders the tab bar inside the page scope', async () => {
  let resolveChunk!: (chunk: DashboardChunk) => void;

  jest.mocked(loadDashboard).mockReturnValue(
    new Promise<DashboardChunk>((resolve) => {
      resolveChunk = resolve;
    })
  );

  renderDashboardPage();

  // The tab bar's toolbar needs the dashboard state, so it waits with the grid,
  // behind the skeleton the page showed while its document loaded: never a blank.
  expect(screen.getByTestId('grid-skeleton')).toBeTruthy();
  expect(screen.queryByTestId('database-tabs')).toBeNull();
  expect(loadDashboard).toHaveBeenCalled();

  await act(async () => {
    resolveChunk(dashboardChunk);
  });

  const tabs = await screen.findByTestId('database-tabs');

  expect(screen.getByTestId('dashboard-scope').contains(tabs)).toBe(true);
  expect(screen.getByTestId('dashboard-layout')).toBeTruthy();
  expect(screen.queryByTestId('grid-skeleton')).toBeNull();
});
