import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, useDatabaseContext } from '@/application/database-yjs';
import { DatabaseViewLayout, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useConditionsActions, useConditionsContext } from '@/components/database/components/conditions/context';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

// The other layouts pull in heavy dependencies (FullCalendar ships ESM) and are not used here.
jest.mock('@/components/database/board', () => ({ Board: () => null }));
jest.mock('@/components/database/chart', () => ({ Chart: () => null }));
jest.mock('@/components/database/fullcalendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/form/FormBuilderView', () => ({ FormBuilderView: () => null }));
jest.mock('@/components/database/gallery', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/list/List', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/list/ListGroupingContext', () => ({
  ListGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  DatabaseSearchProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/database/components/tabs', () => ({
  DatabaseTabs: () => <div data-testid='database-tabs' />,
}));

// The grid reports the viewport it is given and offers a column header "Filter" and "Sort".
jest.mock('@/components/database/grid', () => ({
  Grid: function GridProbe() {
    const { embeddedHeight } = useDatabaseContext();
    const actions = useConditionsActions();

    return (
      <div data-embedded-height={String(embeddedHeight)} data-testid='grid-layout'>
        <button data-testid='column-header-filter' onClick={() => actions?.setExpanded(true)} type='button' />
        <button data-testid='column-header-sort' onClick={() => actions?.setSortMenuOpen(true)} type='button' />
      </div>
    );
  },
}));

jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The widget header reads the conditions popovers its tools open.
jest.mock('@/components/database/dashboard/WidgetHeader', () => ({
  __esModule: true,
  default: function WidgetHeaderProbe() {
    const conditions = useConditionsContext();

    return (
      <div data-testid='widget-header'>
        <output data-testid='filters-open'>{String(conditions?.expanded)}</output>
        <output data-testid='sorts-open'>{String(conditions?.sortMenuOpen)}</output>
      </div>
    );
  },
}));

jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => (
  <div className='database-conditions' data-testid='database-conditions' />
));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDoc(withFilter: boolean): YDoc {
  const doc = new Y.Doc({ guid: 'database-id' }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const filters = new Y.Array();

  view.set(YjsDatabaseKey.id, 'view-id');
  view.set(YjsDatabaseKey.name, 'View');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.created_at, '100');
  view.set(YjsDatabaseKey.filters, filters);
  if (withFilter) {
    const filter = new Y.Map();

    filter.set(YjsDatabaseKey.id, 'filter-1');
    filter.set(YjsDatabaseKey.field_id, 'title');
    filters.push([filter]);
  }

  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function renderWidget({ withFilter = true, isDashboardWidget = true } = {}) {
  const databaseDoc = createDatabaseDoc(withFilter);
  const contextValue: DatabaseContextState = {
    activeViewId: 'view-id',
    databaseDoc,
    databasePageId: 'view-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
    isDashboardWidget,
    isDocumentBlock: true,
    embeddedHeight: 314,
  };

  return render(
    <DatabaseContext.Provider value={contextValue}>
      <DatabaseViews
        activeViewId='view-id'
        databasePageId='view-id'
        fixedHeight={314}
        onChangeView={jest.fn()}
        visibleViewIds={['view-id']}
      />
    </DatabaseContext.Provider>
  );
}

describe('DatabaseViews in a dashboard widget', () => {
  it('renders no conditions bar for a filtered view and keeps the whole card for the viewport', async () => {
    const { container } = renderWidget();
    const grid = await screen.findByTestId('grid-layout');

    expect(container.querySelector('.database-conditions')).toBeNull();
    expect(screen.queryByTestId('database-conditions')).toBeNull();
    expect(grid.getAttribute('data-embedded-height')).toBe('314');
    // The filters exist, but nothing opens by itself (the header loads lazily).
    expect((await screen.findByTestId('filters-open')).textContent).toBe('false');
  });

  it('opens the widget popovers from the column header actions, one at a time', async () => {
    renderWidget();
    await screen.findByTestId('grid-layout');
    await screen.findByTestId('widget-header');

    act(() => screen.getByTestId('column-header-filter').click());
    expect(screen.getByTestId('filters-open').textContent).toBe('true');
    expect(screen.getByTestId('grid-layout').getAttribute('data-embedded-height')).toBe('314');

    act(() => screen.getByTestId('column-header-sort').click());
    expect(screen.getByTestId('sorts-open').textContent).toBe('true');
    expect(screen.getByTestId('filters-open').textContent).toBe('false');
    expect(screen.queryByTestId('database-conditions')).toBeNull();
  });

  it('still shows the conditions bar of a standalone view', async () => {
    renderWidget({ isDashboardWidget: false });

    expect(await screen.findByTestId('database-conditions')).toBeTruthy();
  });
});
