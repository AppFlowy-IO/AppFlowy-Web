import { useCallback, useState } from 'react';

import { GroupColumn, Row, useBoardLayoutSettings, useGetBoardHiddenGroup } from '@/application/database-yjs';
import { useReorderGroupColumnDispatch } from '@/application/database-yjs/dispatch';
import HiddenColumnItem from '@/components/database/components/board/column/HiddenColumnItem';
import HiddenGroupColumnHeader from '@/components/database/components/board/column/HiddenGroupColumnHeader';
import { DragContext, useDragContextValue } from '@/components/database/components/drag-and-drop/useDragContext';

function HiddenGroupColumn({
  groupId,
  fieldId,
  getRows,
  groupRowsReady,
  shownColumnIds,
}: {
  groupId: string;
  fieldId: string;
  getRows: (id: string) => Row[];
  groupRowsReady: boolean;
  shownColumnIds: ReadonlySet<string>;
}) {
  const getRowCount = useCallback((columnId: string) => getRows(columnId).length, [getRows]);
  const { hiddenColumns } = useGetBoardHiddenGroup(groupId, getRowCount, groupRowsReady);
  const { hideEmptyGroups, isCollapsed } = useBoardLayoutSettings();
  const reorderColumn = useReorderGroupColumnDispatch(groupId);
  const onReorder = useCallback(
    ({
      oldData,
      newData,
      startIndex,
      finishIndex,
    }: {
      oldData: GroupColumn[];
      newData: GroupColumn[];
      startIndex: number;
      finishIndex: number;
    }) => {
      const columnId = oldData[startIndex].id;

      if (!columnId) {
        throw new Error('No columnId provided');
      }

      const beforeId = newData[finishIndex - 1]?.id;

      reorderColumn(columnId, beforeId);
    },
    [reorderColumn]
  );

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const contextValue = useDragContextValue({
    data: hiddenColumns,
    enabled: !isCollapsed,
    reorderAction: onReorder,
    container,
  });

  return (
    <div
      data-testid={'board-hidden-groups'}
      ref={setContainer}
      style={{
        width: isCollapsed ? '32px' : '240px',
      }}
      className={'flex transform flex-col  gap-2 overflow-hidden transition-all'}
    >
      <HiddenGroupColumnHeader />
      {!isCollapsed && (
        <DragContext.Provider value={contextValue}>
          <div data-testid={'board-hidden-groups-list'} className={'flex flex-col justify-start'}>
            {hiddenColumns.map((column) => (
              <HiddenColumnItem
                key={column.id}
                fieldId={fieldId}
                id={column.id}
                getRows={getRows}
                groupId={groupId}
                isShownOnBoard={shownColumnIds.has(column.id)}
                automaticallyHidden={groupRowsReady && hideEmptyGroups && getRows(column.id).length === 0}
              />
            ))}
          </div>
        </DragContext.Provider>
      )}
    </div>
  );
}

export default HiddenGroupColumn;
