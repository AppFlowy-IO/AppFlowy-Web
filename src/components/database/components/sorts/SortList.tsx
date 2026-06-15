import { useCallback, useMemo, useState } from 'react';

import { useReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useReorderSorts } from '@/application/database-yjs/dispatch';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { useDragContextValue, DragContext } from '@/components/database/components/drag-and-drop/useDragContext';
import Sort from '@/components/database/components/sorts/Sort';

function SortList () {
  const sorts = useSortsSelector();
  const readOnly = useReadOnly();

  const reorderSorts = useReorderSorts();
  const data = useMemo(() => {
    return sorts.map((sort) => ({
      id: sort.id,
    }));
  }, [sorts]);

  const onReorder = useCallback(({
    oldData,
    newData,
    startIndex,
    finishIndex,
  }: {
    oldData: {
      id: string
    }[]
    newData: {
      id: string
    }[]
    startIndex: number
    finishIndex: number
  }) => {
    const optionId = oldData[startIndex].id;

    if (!optionId) {
      throw new Error('No optionId provided');
    }

    const beforeId = newData[finishIndex - 1]?.id;

    reorderSorts(optionId, beforeId);
  }, [reorderSorts]);

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const dragContentValue = useDragContextValue({
    enabled: !readOnly,
    data,
    reorderAction: onReorder,
    container,
  });

  return (
    <div
      ref={setContainer}
      className={'flex w-fit flex-col gap-2'}
    >
      <DragContext.Provider value={dragContentValue}>
        {sorts.map((sort) => readOnly ? (
          <Sort
            sortId={sort.id}
            key={sort.id}
          />
        ) : (
          <DragItem
            id={sort.id}
            key={sort.id}
          >
            <Sort sortId={sort.id} />
          </DragItem>
        ))}
      </DragContext.Provider>
    </div>
  );
}

export default SortList;
