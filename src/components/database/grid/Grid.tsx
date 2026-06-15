import { useEffect } from 'react';

import { useDatabaseContext, useDatabaseViewId, useRowOrdersSelector } from '@/application/database-yjs';
import { useRenderFields } from '@/components/database/components/grid/grid-column';
import GridVirtualizer from '@/components/database/components/grid/grid-table/GridVirtualizer';
import { GridProvider } from '@/components/database/grid/GridProvider';

export function Grid() {
  const { fields } = useRenderFields();
  const viewId = useDatabaseViewId();
  const rowOrders = useRowOrdersSelector();

  const { onRendered } = useDatabaseContext();

  useEffect(() => {
    if (fields && rowOrders !== undefined) {
      onRendered?.();
    }
  }, [fields, rowOrders, onRendered]);

  return (
    <GridProvider rowOrders={rowOrders}>
      <div
        data-testid='database-grid'
        className={`database-grid relative grid-table-${viewId} flex w-full min-h-0 flex-1 flex-col`}
      >
        <GridVirtualizer columns={fields} />
      </div>
    </GridProvider>
  );
}

export default Grid;
