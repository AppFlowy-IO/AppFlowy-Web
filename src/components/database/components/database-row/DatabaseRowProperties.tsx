import { useCallback, useMemo, useState } from 'react';

import { FieldVisibility, isAIFieldType, useFieldsSelector, usePrimaryFieldId, useReadOnly } from '@/application/database-yjs';
import { useReorderPropertiesDispatch } from '@/application/database-yjs/dispatch/property-order';
import { useAIEnabled } from '@/components/app/app.hooks';
import RowNewProperty from '@/components/database/components/database-row/RowNewProperty';
import RowProperty from '@/components/database/components/database-row/RowProperty';
import RowSwitchFieldsHidden from '@/components/database/components/database-row/RowSwitchFieldsHidden';
import { DragContext, useDragContextValue } from '@/components/database/components/drag-and-drop/useDragContext';
import { getScrollParent } from '@/components/global-comment/utils';
import { cn } from '@/lib/utils';

const allVisibilities = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty, FieldVisibility.AlwaysHidden];

export function DatabaseRowProperties({ rowId, templateStyle = false }: { rowId: string; templateStyle?: boolean }) {
  const primaryFieldId = usePrimaryFieldId();
  const [isFilterHidden, setIsFilterHidden] = useState(true);
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null);
  const aiEnabled = useAIEnabled();

  const columns = useFieldsSelector(allVisibilities);
  const rowProperties = useMemo(
    () => columns.filter((column) => column.fieldId !== primaryFieldId && (aiEnabled || !isAIFieldType(column.fieldType))),
    [aiEnabled, columns, primaryFieldId]
  );
  const fields = useMemo(
    () => rowProperties.filter((column) => !isFilterHidden || column.visibility !== FieldVisibility.AlwaysHidden),
    [isFilterHidden, rowProperties]
  );
  const hiddenCount = rowProperties.filter((column) => column.visibility === FieldVisibility.AlwaysHidden).length;
  const readOnly = useReadOnly();

  const dragData = useMemo(() => {
    return fields.map((field) => ({ id: field.fieldId }));
  }, [fields]);

  const [dom, setDom] = useState<HTMLElement | null>(null);
  const reorderProperties = useReorderPropertiesDispatch();
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

      reorderProperties(optionId, newData.map((property) => property.id));
    },
    [reorderProperties]
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
          readOnly ? 'px-24 max-sm:px-6' : 'px-[70px] max-sm:px-2',
          templateStyle && 'px-0 py-0'
        )}
      >
        {fields.map((field) => {
          return (
            <RowProperty
              key={field.fieldId}
              rowId={rowId}
              fieldId={field.fieldId}
              isActive={activePropertyId === field.fieldId}
              setActivePropertyId={setActivePropertyId}
              templateStyle={templateStyle}
            />
          );
        })}
        {!readOnly && (
          <>
            <RowSwitchFieldsHidden
              hideCount={hiddenCount}
              isFilterHidden={isFilterHidden}
              templateStyle={templateStyle}
              onToggleSwitchFieldsHidden={() => {
                setIsFilterHidden((prev) => !prev);
              }}
            />
            {!templateStyle ? <RowNewProperty setActivePropertyId={setActivePropertyId} /> : null}
          </>
        )}
      </div>
    </DragContext.Provider>
  );
}

export default DatabaseRowProperties;
