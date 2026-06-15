import { useCallback, useMemo, useState } from 'react';

import { isAIFieldType, usePrimaryFieldId, usePropertiesSelector, useReadOnly } from '@/application/database-yjs';
import { useReorderColumnDispatch } from '@/application/database-yjs/dispatch';
import { useAIEnabled } from '@/components/app/app.hooks';
import RowNewProperty from '@/components/database/components/database-row/RowNewProperty';
import RowProperty from '@/components/database/components/database-row/RowProperty';
import RowSwitchFieldsHidden from '@/components/database/components/database-row/RowSwitchFieldsHidden';
import { DragContext, useDragContextValue } from '@/components/database/components/drag-and-drop/useDragContext';
import { getScrollParent } from '@/components/global-comment/utils';
import { cn } from '@/lib/utils';

export function DatabaseRowProperties({ rowId }: { rowId: string }) {
  const primaryFieldId = usePrimaryFieldId();
  const [isFilterHidden, setIsFilterHidden] = useState(true);
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null);
  const aiEnabled = useAIEnabled();

  const { properties, hiddenProperties } = usePropertiesSelector(isFilterHidden);
  const fields = useMemo(() => {
    return properties.filter((column) => column.id !== primaryFieldId && (aiEnabled || !isAIFieldType(column.type)));
  }, [aiEnabled, properties, primaryFieldId]);
  const visibleHiddenProperties = useMemo(() => {
    return hiddenProperties.filter((column) => aiEnabled || !isAIFieldType(column.type));
  }, [aiEnabled, hiddenProperties]);
  const readOnly = useReadOnly();

  const dragData = useMemo(() => {
    return fields.map((field) => ({ id: field.id }));
  }, [fields]);

  const [dom, setDom] = useState<HTMLElement | null>(null);
  const recorderColumn = useReorderColumnDispatch();
  const onReorder = useCallback(
    ({
      oldData,
      newData,
      startIndex,
      finishIndex,
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

      const beforeId = newData[finishIndex - 1]?.id;

      recorderColumn(optionId, beforeId);
    },
    [recorderColumn]
  );

  const container = useMemo(() => {
    return (dom?.closest('.appflowy-scroll-container') as HTMLDivElement) || (getScrollParent(dom) as HTMLDivElement);
  }, [dom]);

  const dragContentValue = useDragContextValue({
    enabled: !readOnly,
    data: dragData,
    reorderAction: onReorder,
    container,
  });

  return (
    <DragContext.Provider value={dragContentValue}>
      <div
        ref={setDom}
        className={cn(
          'row-properties flex w-full flex-col py-2',
          readOnly ? 'px-24 max-sm:px-6' : 'px-[70px] max-sm:px-2'
        )}
      >
        {fields.map((field) => {
          return (
            <RowProperty
              key={field.id}
              rowId={rowId}
              fieldId={field.id}
              isActive={activePropertyId === field.id}
              setActivePropertyId={setActivePropertyId}
            />
          );
        })}
        {!readOnly && (
          <>
            <RowSwitchFieldsHidden
              hideCount={visibleHiddenProperties.length}
              isFilterHidden={isFilterHidden}
              onToggleSwitchFieldsHidden={() => {
                setIsFilterHidden((prev) => !prev);
              }}
            />
            <RowNewProperty setActivePropertyId={setActivePropertyId} />
          </>
        )}
      </div>
    </DragContext.Provider>
  );
}

export default DatabaseRowProperties;
