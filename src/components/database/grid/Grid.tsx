import { useDatabaseViewId } from '@/application/database-yjs';
import { useRenderFields } from '@/components/database/components/grid/grid-column';
import GridVirtualizer from '@/components/database/components/grid/grid-table/GridVirtualizer';
import { GridProvider } from '@/components/database/grid/GridProvider';
import React from 'react';

export function Grid () {
  const { fields } = useRenderFields();
  const viewId = useDatabaseViewId();

  return (
    <GridProvider>
      <div className={`database-grid relative grid-table-${viewId} flex w-full flex-1 flex-col`}>
        <GridVirtualizer
          columns={fields}
        />
      </div>
    </GridProvider>

  );
}

export default Grid;
