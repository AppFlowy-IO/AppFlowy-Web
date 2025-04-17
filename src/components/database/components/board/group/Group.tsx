import { useDatabaseContext, useRowsByGroup } from '@/application/database-yjs';
import { BoardContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { useColumnsDrag } from '@/components/database/components/board/drag-and-drop/useColumnsDrag';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Column } from '../column';

export interface GroupProps {
  groupId: string;
}

export const Group = ({ groupId }: GroupProps) => {
  const { columns, groupResult, fieldId, notFound } = useRowsByGroup(groupId);
  const { t } = useTranslation();
  const context = useDatabaseContext();
  const scrollLeft = context.scrollLeft;
  const maxHeightRef = useRef<number>(0);
  const onRendered = context?.onRendered;
  const isDocumentBlock = context.isDocumentBlock;

  const getCards = useCallback((columnId: string) => {
    return groupResult.get(columnId);
  }, [groupResult]);

  const { contextValue, scrollableRef: ref } = useColumnsDrag(groupId, columns, getCards);
  const handleRendered = useCallback((height: number) => {
    maxHeightRef.current = Math.max(maxHeightRef.current, height);

    onRendered?.(maxHeightRef.current);
  }, [onRendered]);

  useEffect(() => {
    const el = ref.current;

    if (!el || !isDocumentBlock) return;

    handleRendered(el.clientHeight);
  }, [isDocumentBlock, handleRendered, ref]);

  if (notFound) {
    return (
      <div className={'mt-[10%] flex h-full w-full flex-col items-center gap-2 text-text-caption'}>
        <div className={'text-sm font-medium'}>{t('board.noGroup')}</div>
        <div className={'text-xs'}>{t('board.noGroupDesc')}</div>
      </div>
    );
  }

  if (columns.length === 0 || !fieldId) return null;
  return (
    <BoardContext.Provider value={contextValue}>
      <div
        ref={ref}
        className={'max-sm:!px-6 px-24 appflowy-scroller overflow-x-auto h-full'}
        style={{
          paddingInline: scrollLeft === undefined ? undefined : scrollLeft,
        }}
      >
        <div
          className="columns flex h-full w-fit min-w-full gap-2"
        >
          {columns.map((data) => (
            <Column
              key={data.id}
              id={data.id}
              fieldId={fieldId}
              rows={groupResult.get(data.id) || []}
              onRendered={handleRendered}
            />
          ))}
        </div>
      </div>
    </BoardContext.Provider>
  );
};

export default Group;
