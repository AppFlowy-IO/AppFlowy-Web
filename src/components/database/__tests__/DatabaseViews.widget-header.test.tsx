import { render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { createDatabaseDoc } from '@/components/database/dashboard/__tests__/dashboardTestHarness';
import DatabaseViews from '@/components/database/DatabaseViews';

import type { ReactNode } from 'react';

// The only render of this file: a module-level lazy component that resolved in
// an earlier test would render at once and hide the defect this file guards.

// The other layouts pull in heavy dependencies (FullCalendar ships ESM) and are not used here.
jest.mock('@/components/database/board', () => ({ Board: () => null }));
jest.mock('@/components/database/chart', () => ({ Chart: () => null }));
jest.mock('@/components/database/fullcalendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/form/FormBuilderView', () => ({ FormBuilderView: () => null }));
jest.mock('@/components/database/gallery', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/list/List', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/conditions/DatabaseSearchContext', () => ({
  DatabaseSearchProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/database/components/tabs', () => ({ DatabaseTabs: () => null }));
jest.mock('@/components/database/grid/GridGroupingContext', () => ({
  GridGroupingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Whether the widget header was in the document when each grid committed for the first time.
const mockHeaderAtGridMount: boolean[] = [];

jest.mock('@/components/database/grid', () => ({
  Grid: function GridProbe() {
    useLayoutEffect(() => {
      mockHeaderAtGridMount.push(document.querySelector('[data-testid="widget-header"]') !== null);
    }, []);
    return <div data-testid='grid-layout' />;
  },
}));

jest.mock('@/components/database/dashboard/WidgetHeader', () => ({
  __esModule: true,
  default: () => <div data-testid='widget-header' />,
}));

it("commits a dashboard widget's header with its first rows, never a blank band above them", async () => {
  const { doc } = createDatabaseDoc({
    id: 'database-id',
    views: [{ id: 'view-id', name: 'View', layout: DatabaseViewLayout.Grid, createdAt: '100' }],
  });
  const context: DatabaseContextState = {
    activeViewId: 'view-id',
    databaseDoc: doc,
    databasePageId: 'view-id',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace-id',
    isDashboardWidget: true,
    isDocumentBlock: true,
    embeddedHeight: 314,
  };

  render(
    <DatabaseContext.Provider value={context}>
      <DatabaseViews
        activeViewId='view-id'
        databasePageId='view-id'
        fixedHeight={314}
        onChangeView={jest.fn()}
        visibleViewIds={['view-id']}
      />
    </DatabaseContext.Provider>
  );

  await screen.findByTestId('grid-layout');
  expect(screen.getByTestId('widget-header')).toBeTruthy();
  // A lazily loaded header suspended on the first widget that mounted it, and
  // that widget committed its rows under the empty fallback.
  expect(mockHeaderAtGridMount).toEqual([true]);
});
