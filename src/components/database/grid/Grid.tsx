import { useDatabaseViewId } from '@/application/database-yjs';
import { useRenderFields } from '@/components/database/components/grid/grid-column';
import { useRenderRows } from '@/components/database/components/grid/grid-row';
import GridVirtualizer from '@/components/database/components/grid/grid-table/GridVirtualizer';
import React from 'react';

export function Grid () {
  const { fields } = useRenderFields();
  const { rows } = useRenderRows();
  const viewId = useDatabaseViewId();

  return (
    <div className={`database-grid relative grid-table-${viewId} flex w-full flex-1 flex-col`}>
      <GridVirtualizer
        data={rows}
        columns={fields}
      />
    </div>

  );
}

export default Grid;
