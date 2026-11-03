import { expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/database/components/tabs', () => ({
  DatabaseTabs: () => <div data-testid='database-tabs' />,
}));

jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/grid', () => ({
  Grid: () => {
    throw new Error('Grid render failed');
  },
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
  default: () => null,
}));

jest.mock('@/components/database/list/List', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/form/FormBuilderView', () => ({
  FormBuilderView: () => null,
}));

jest.mock('@/components/database/DatabaseHistoryScope', () => ({
  DatabaseHistoryScope: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => null);

function createGridDatabaseDoc(): YDoc {
  const doc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();

  view.set(YjsDatabaseKey.id, 'view-id');
  view.set(YjsDatabaseKey.name, 'View');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.created_at, '100');
  view.set(YjsDatabaseKey.is_inline, false);
  view.set(YjsDatabaseKey.embedded, false);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

// Stands in for the page-level boundary in MainLayout.
function PageError({ error }: FallbackProps) {
  return <div data-testid='page-error'>{String(error)}</div>;
}

describe('DatabaseViews render errors', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows a view render failure inline and keeps the tabs', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const databaseDoc = createGridDatabaseDoc();
    const contextValue: DatabaseContextState = {
      activeViewId: 'view-id',
      databaseDoc,
      databasePageId: 'view-id',
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
    };
    const { unmount } = render(
      <ErrorBoundary FallbackComponent={PageError}>
        <DatabaseContext.Provider value={contextValue}>
          <DatabaseViews
            activeViewId='view-id'
            databasePageId='view-id'
            onChangeView={jest.fn()}
            visibleViewIds={['view-id']}
          />
        </DatabaseContext.Provider>
      </ErrorBoundary>
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('page-error')).toBeNull();
    expect(screen.getByTestId('database-tabs')).toBeTruthy();

    unmount();
    databaseDoc.destroy();
  });
});
