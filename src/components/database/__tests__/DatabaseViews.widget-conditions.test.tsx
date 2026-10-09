import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, useDatabaseContext } from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { useConditionsActions, useConditionsContext } from '@/components/database/components/conditions/context';
import { createDatabaseDoc as createDatabaseFixture } from '@/components/database/dashboard/__tests__/dashboardTestHarness';
import { WidgetCompositionProvider } from '@/components/database/dashboard/WidgetCompositionProvider';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

// The other layouts pull in heavy dependencies (FullCalendar ships ESM) and are not used here.
jest.mock('@/components/database/board', () => ({ Board: () => <div data-testid='board-layout' /> }));
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

// The conditions bar reports whether it is revealed.
jest.mock('src/components/database/components/conditions/DatabaseConditions', () => {
  const { useConditionsContext: useConditions } = jest.requireActual<
    typeof import('@/components/database/components/conditions/context')
  >('@/components/database/components/conditions/context');

  return function DatabaseConditionsProbe() {
    const conditions = useConditions();

    return (
      <div
        className='database-conditions'
        data-expanded={String(conditions?.expanded)}
        data-testid='database-conditions'
      />
    );
  };
});

/** The database `database-id` with a grid view `view-id` (with one filter) and a board view. */
function createDatabaseDoc(withFilter: boolean) {
  const fixture = createDatabaseFixture({
    id: 'database-id',
    views: [
      { id: 'view-id', name: 'View', layout: DatabaseViewLayout.Grid, createdAt: '100' },
      { id: 'board-id', name: 'Board', layout: DatabaseViewLayout.Board, createdAt: '200' },
    ],
  });
  const filters = new Y.Array();

  fixture.view('view-id').set(YjsDatabaseKey.filters, filters as never);
  if (withFilter) {
    const filter = new Y.Map();

    filter.set(YjsDatabaseKey.id, 'filter-1');
    filter.set(YjsDatabaseKey.field_id, 'title');
    filters.push([filter]);
  }

  return fixture;
}

function renderWidget({ withFilter = true, isDashboardWidget = true } = {}) {
  const fixture = createDatabaseDoc(withFilter);
  const databaseDoc = fixture.doc;
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

  const tree = (activeViewId: string) => (
    <WidgetCompositionProvider>
      <DatabaseContext.Provider value={{ ...contextValue, activeViewId }}>
        <DatabaseViews
          activeViewId={activeViewId}
          databasePageId='view-id'
          fixedHeight={314}
          onChangeView={jest.fn()}
          visibleViewIds={['view-id', 'board-id']}
        />
      </DatabaseContext.Provider>
    </WidgetCompositionProvider>
  );
  const result = render(tree('view-id'));

  return { ...result, fixture, showView: (viewId: string) => result.rerender(tree(viewId)) };
}

describe('DatabaseViews in a dashboard widget', () => {
  it('renders no conditions bar for a filtered view and keeps the whole card for the viewport', async () => {
    const { container } = renderWidget();
    const grid = await screen.findByTestId('grid-layout');

    expect(container.querySelector('.database-conditions')).toBeNull();
    expect(screen.queryByTestId('database-conditions')).toBeNull();
    expect(grid.getAttribute('data-embedded-height')).toBe('314');
    // The filters exist, but nothing opens by itself.
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

  it('follows a layout conversion of its view', async () => {
    const { fixture } = renderWidget();

    await screen.findByTestId('grid-layout');
    act(() => {
      fixture.view('view-id').set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    });

    expect(await screen.findByTestId('board-layout')).toBeTruthy();
    expect(screen.queryByTestId('grid-layout')).toBeNull();
    // Still the widget composition: its header, no tabs and no conditions bar.
    expect(screen.getByTestId('widget-header')).toBeTruthy();
    expect(screen.queryByTestId('database-tabs')).toBeNull();
  });

  it('shows its view once the view syncs in after the database opened', async () => {
    const { fixture } = renderWidget();

    await screen.findByTestId('widget-header');
    act(() => {
      fixture.views.delete('view-id');
    });
    expect(screen.queryByTestId('grid-layout')).toBeNull();

    act(() => {
      const view = new Y.Map();

      view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
      fixture.views.set('view-id', view as never);
    });
    expect(await screen.findByTestId('grid-layout')).toBeTruthy();
  });

  it('leaves the stored tab order of its source database alone', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    renderWidget();
    await screen.findByTestId('grid-layout');

    expect(setItem.mock.calls.filter(([key]) => String(key).includes('database-id'))).toEqual([]);
    setItem.mockRestore();
  });

  it('still shows the conditions bar of a standalone view', async () => {
    renderWidget({ isDashboardWidget: false });

    expect(await screen.findByTestId('database-conditions')).toBeTruthy();
    expect(screen.getByTestId('database-tabs')).toBeTruthy();
    expect(screen.queryByTestId('widget-header')).toBeNull();
  });

  it('keeps the conditions bar of a standalone view revealed across a tab switch to another layout', async () => {
    const { showView } = renderWidget({ isDashboardWidget: false });

    // The view has a filter: the bar reveals itself.
    expect((await screen.findByTestId('database-conditions')).getAttribute('data-expanded')).toBe('true');
    showView('board-id');
    expect(await screen.findByTestId('board-layout')).toBeTruthy();
    expect(screen.getByTestId('database-conditions').getAttribute('data-expanded')).toBe('true');
  });
});
