import { useCallback, useMemo, useState } from 'react';

import { useReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useReorderSorts } from '@/application/database-yjs/dispatch';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { useDragContextValue, DragContext } from '@/components/database/components/drag-and-drop/useDragContext';
import Sort from '@/components/database/components/sorts/Sort';

function SortList() {
  const sorts = useSortsSelector();
  const readOnly = useReadOnly();

  const reorderSorts = useReorderSorts();
  const data = useMemo(() => sorts.map((sort) => ({ id: sort.id })), [sorts]);

  const onReorder = useCallback(
    ({
      oldData,
      newData,
      startIndex,
    }: {
      oldData: {
        id: string;
      }[];
      newData: {
        id: string;
      }[];
      startIndex: number;
      finishIndex: number;
    }) => {
      const optionId = oldData[startIndex].id;

      if (!optionId) {
        throw new Error('No optionId provided');
      }

      const index = newData.findIndex(({ id }) => id === optionId);

      if (index !== startIndex) reorderSorts(optionId, newData[index - 1]?.id);
    },
    [reorderSorts]
  );

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const move = (startIndex: number, finishIndex: number) => {
    if (finishIndex < 0 || finishIndex >= data.length) return;
    const newData = [...data];

    newData.splice(finishIndex, 0, newData.splice(startIndex, 1)[0]);
    void onReorder({ oldData: data, newData, startIndex, finishIndex });
  };

  const dragContentValue = useDragContextValue({
    enabled: !readOnly,
    data,
    reorderAction: onReorder,
    container,
  });

  return (
    <div ref={setContainer} className={'flex w-fit flex-col gap-2'}>
      <DragContext.Provider value={dragContentValue}>
        {data.map((sort, index) =>
          readOnly ? (
            <div key={sort.id}>
              <Sort sortId={sort.id} />
            </div>
          ) : (
            <DragItem
              id={sort.id}
              key={sort.id}
              dragHandleLabel='Reorder sort'
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
            >
              <Sort sortId={sort.id} />
            </DragItem>
          )
        )}
      </DragContext.Provider>
    </div>
  );
}

export default SortList;
