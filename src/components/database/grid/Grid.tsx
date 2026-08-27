import { useEffect } from 'react';

import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { useRenderFields } from '@/components/database/components/grid/grid-column';
import GridVirtualizer from '@/components/database/components/grid/grid-table/GridVirtualizer';
import { useGridGrouping } from '@/components/database/grid/GridGroupingContext';
import { GridProvider } from '@/components/database/grid/GridProvider';

export function Grid() {
  const { fields } = useRenderFields();
  const viewId = useDatabaseViewId();
  const grouping = useGridGrouping();
  const { rowOrders } = grouping;

  const { onRendered } = useDatabaseContext();

  useEffect(() => {
    if (fields && rowOrders !== undefined) {
      onRendered?.();
    }
  }, [fields, rowOrders, onRendered]);

  return (
    <GridProvider grouping={grouping}>
      <div
        data-testid='database-grid'
        className={`database-grid relative grid-table-${viewId} flex min-h-0 w-full flex-1 flex-col`}
      >
        <GridVirtualizer columns={fields} />
      </div>
    </GridProvider>
  );
}

export default Grid;
