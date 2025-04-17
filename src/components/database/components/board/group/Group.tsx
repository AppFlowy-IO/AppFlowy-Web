import { useDatabaseContext, useRowsByGroup } from '@/application/database-yjs';
import { BoardContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { useColumnsDrag } from '@/components/database/components/board/drag-and-drop/useColumnsDrag';
import { getScrollParent } from '@/components/global-comment/utils';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const [draggingBottomScrollbar, setDraggingBottomScrollbar] = useState(false);
  const [isHover, setIsHover] = useState(false);
  const [verticalScrollContainer, setVerticalScrollContainer] = useState<HTMLElement | null>(null);
  const getVerticalScrollContainer = useCallback((el: HTMLDivElement) => {
    return (el.closest('.appflowy-scroll-container') || getScrollParent(el)) as HTMLElement;
  }, []);

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
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        ref={el => {
          ref.current = el;
          if (!el) return;
          const container = getVerticalScrollContainer(el);

          if (!container) return;
          setVerticalScrollContainer(container);
        }}
        className={'max-sm:!px-6 px-24 appflowy-custom-scroller overflow-x-auto h-full'}
        style={{
          paddingInline: scrollLeft === undefined ? undefined : scrollLeft,
          scrollBehavior: 'auto',
        }}
        onScroll={e => {
          if (draggingBottomScrollbar) return;
          const scrollLeft = e.currentTarget.scrollLeft;

          const bottomScrollbar = bottomScrollbarRef.current;

          if (!bottomScrollbar) return;

          bottomScrollbar.scroll({
            left: scrollLeft,
            behavior: 'auto',
          });
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
        {verticalScrollContainer && createPortal(<div
          style={{
            width: '100%',
            position: 'sticky',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
          }}
        >
          <div
            ref={bottomScrollbarRef}
            style={{
              scrollBehavior: 'auto',
              visibility: isHover ? 'visible' : 'hidden',
            }}
            onMouseDown={() => {
              setDraggingBottomScrollbar(true);
            }}
            onMouseUp={() => {
              setDraggingBottomScrollbar(false);
            }}
            onScroll={e => {
              if (!draggingBottomScrollbar) return;
              const scrollLeft = e.currentTarget.scrollLeft;

              ref.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
            className={'h-3 w-full opacity-30 hover:opacity-60 overflow-y-hidden overflow-x-auto'}
          >
            <div
              style={{
                width: `${ref.current?.scrollWidth}px`,
              }}
            >
              &nbsp;
            </div>
          </div>
        </div>, verticalScrollContainer)}
      </div>

    </BoardContext.Provider>
  );
};

export default Group;
