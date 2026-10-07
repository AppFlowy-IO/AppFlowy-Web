import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType } from '@/application/database-yjs';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseViewLayout, type YDatabaseField, type YDatabaseRowOrders, YjsDatabaseKey } from '@/application/types';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { createDatabaseDoc } from '@/components/database/dashboard/__tests__/dashboardTestHarness';
import { WidgetCompositionProvider } from '@/components/database/dashboard/WidgetCompositionProvider';
import DatabaseViews from '@/components/database/DatabaseViews';
import { useGridGrouping } from '@/components/database/grid/GridGroupingContext';
import { useListGrouping } from '@/components/database/list/ListGroupingContext';

// Keep the search provider, grouping providers and row selectors real. Only
// replace the controls and renderers to observe the rows they receive.
function SearchControls() {
  const { setQuery, clearSearch } = useDatabaseSearch();

  return (
    <>
      <button onClick={() => setQuery('alpha')} type='button'>Search alpha</button>
      <button onClick={() => setQuery('missing')} type='button'>Search missing</button>
      <button onClick={() => clearSearch()} type='button'>Clear search</button>
    </>
  );
}

jest.mock('@/components/database/components/tabs', () => ({ DatabaseTabs: () => <SearchControls /> }));
jest.mock('@/components/database/dashboard/WidgetHeader', () => ({
  __esModule: true,
  default: () => <SearchControls />,
}));
jest.mock('@/components/database/grid', () => ({
  Grid: function GridRows() {
    const { rowOrders } = useGridGrouping();

    return <output data-testid='visible-rows'>{rowOrders?.map(({ id }) => id).join(',') ?? 'loading'}</output>;
  },
}));
jest.mock('@/components/database/list/List', () => ({
  __esModule: true,
  default: function ListRows() {
    const { rowOrders } = useListGrouping();

    return <output data-testid='visible-rows'>{rowOrders?.map(({ id }) => id).join(',') ?? 'loading'}</output>;
  },
}));
jest.mock('@/components/database/board', () => ({ Board: () => null }));
jest.mock('@/components/database/chart', () => ({ Chart: () => null }));
jest.mock('@/components/database/fullcalendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/form/FormBuilderView', () => ({ FormBuilderView: () => null }));
jest.mock('@/components/database/gallery', () => ({ __esModule: true, default: () => null }));
jest.mock('src/components/database/components/conditions/DatabaseConditions', () => () => null);

it.each([
  ['page grid', DatabaseViewLayout.Grid, false],
  ['page list', DatabaseViewLayout.List, false],
  ['widget grid', DatabaseViewLayout.Grid, true],
  ['widget list', DatabaseViewLayout.List, true],
] as const)('filters and restores rows through the %s search provider', async (_label, layout, isDashboardWidget) => {
  const fixture = createDatabaseDoc({
    id: 'search-database',
    views: [{ id: 'search-view', name: 'Search', layout, createdAt: '100' }],
  });
  const title = new Y.Map() as YDatabaseField;
  const rowOrders = new Y.Array() as YDatabaseRowOrders;

  title.set(YjsDatabaseKey.id, 'title');
  title.set(YjsDatabaseKey.type, FieldType.RichText);
  title.set(YjsDatabaseKey.is_primary, true);
  fixture.database.get(YjsDatabaseKey.fields).set('title', title);
  rowOrders.push([{ id: 'row-alpha', height: 36 }, { id: 'row-beta', height: 36 }]);
  fixture.view('search-view').set(YjsDatabaseKey.row_orders, rowOrders);
  const rowMap = {
    'row-alpha': createRowDoc('row-alpha', 'search-database', { title: createCell(FieldType.RichText, 'Alpha') }),
    'row-beta': createRowDoc('row-beta', 'search-database', { title: createCell(FieldType.RichText, 'Beta') }),
  };
  const context: DatabaseContextState = {
    activeViewId: 'search-view',
    databaseDoc: fixture.doc,
    databasePageId: 'search-view',
    readOnly: true,
    rowMap,
    workspaceId: 'workspace-id',
    isDashboardWidget,
  };
  const { unmount } = render(
    <WidgetCompositionProvider>
      <DatabaseContext.Provider value={context}>
        <DatabaseViews activeViewId='search-view' databasePageId='search-view' onChangeView={jest.fn()} />
      </DatabaseContext.Provider>
    </WidgetCompositionProvider>
  );

  await waitFor(() => expect(screen.getByTestId('visible-rows').textContent).toBe('row-alpha,row-beta'));
  fireEvent.click(screen.getByRole('button', { name: 'Search alpha' }));
  await waitFor(() => expect(screen.getByTestId('visible-rows').textContent).toBe('row-alpha'));
  fireEvent.click(screen.getByRole('button', { name: 'Search missing' }));
  await waitFor(() => expect(screen.getByTestId('visible-rows').textContent).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  await waitFor(() => expect(screen.getByTestId('visible-rows').textContent).toBe('row-alpha,row-beta'));

  unmount();
  Object.values(rowMap).forEach((doc) => doc.destroy());
  fixture.doc.destroy();
});
