import { useEffect } from 'react';

import { useDatabaseContext, useDatabaseSearchQuery, useDatabaseViewId } from '@/application/database-yjs';
import { DatabaseSearchEmptyState } from '@/components/database/components/conditions/DatabaseSearchEmptyState';
import { useRenderFields } from '@/components/database/components/grid/grid-column';
import GridVirtualizer from '@/components/database/components/grid/grid-table/GridVirtualizer';
import { useGridGrouping } from '@/components/database/grid/GridGroupingContext';
import { GridProvider } from '@/components/database/grid/GridProvider';
import {
  DASHBOARD_WIDGET_GRID_OPTIONS,
  DEFAULT_GRID_OPTIONS,
  GridOptionsContext,
} from '@/components/database/grid/useGridContext';

export function Grid() {
  const { fields } = useRenderFields();
  const viewId = useDatabaseViewId();
  const grouping = useGridGrouping();
  const { rowOrders, hydrating } = grouping;

  const { onRendered, isDashboardWidget } = useDatabaseContext();
  // A settled search with no match replaces the header, rows, footer and new row (WP09 §1.2).
  const searchQuery = useDatabaseSearchQuery();
  const searchFoundNothing = searchQuery !== '' && !hydrating && rowOrders !== undefined && rowOrders.length === 0;

  useEffect(() => {
    if (fields && rowOrders !== undefined) {
      onRendered?.();
    }
  }, [fields, rowOrders, onRendered]);

  return (
    <GridOptionsContext.Provider value={isDashboardWidget ? DASHBOARD_WIDGET_GRID_OPTIONS : DEFAULT_GRID_OPTIONS}>
      <GridProvider grouping={grouping}>
        <div
          data-testid='database-grid'
          // Rows the grid lists after filters and sorts, once every row was read;
          // large-database tests read it. While rows are read the grid shows the
          // matches found so far (data-loaded-row-count).
          data-row-count={hydrating ? undefined : rowOrders?.length}
          data-loaded-row-count={hydrating ? rowOrders?.length ?? 0 : undefined}
          data-hydrating={hydrating ? 'true' : undefined}
          className={`database-grid relative grid-table-${viewId} flex min-h-0 w-full flex-1 flex-col`}
        >
          {searchFoundNothing ? (
            <DatabaseSearchEmptyState />
          ) : (
            // Memoized: a progress-only tick re-renders this component, not the rows.
            <GridVirtualizer columns={fields} />
          )}
        </div>
      </GridProvider>
    </GridOptionsContext.Provider>
  );
}

export default Grid;
