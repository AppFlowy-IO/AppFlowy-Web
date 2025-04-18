import { PADDING_END, useDatabaseContext, useRowsByGroup } from '@/application/database-yjs';
import { BoardContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { useColumnsDrag } from '@/components/database/components/board/drag-and-drop/useColumnsDrag';
import GroupHeader from '@/components/database/components/board/group/GroupHeader';
import GroupStickyHeader from '@/components/database/components/board/group/GroupStickyHeader';
import DatabaseStickyHorizontalScrollbar
  from '@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar';
import DatabaseStickyBottomOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay';
import DatabaseStickyTopOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay';
import { getScrollParent } from '@/components/global-comment/utils';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const [isHover, setIsHover] = useState(false);
  const [verticalScrollContainer, setVerticalScrollContainer] = useState<HTMLElement | null>(null);
  const getVerticalScrollContainer = useCallback((el: HTMLDivElement) => {
    return (el.closest('.appflowy-scroll-container') || getScrollParent(el)) as HTMLElement;
  }, []);
  const [totalSize, setTotalSize] = useState<number>(0);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    const columnsEl = ref.current;

    if (!verticalScrollContainer || !header || !columnsEl) return;

    const stickyHeader = stickyHeaderRef.current;

    if (!stickyHeader) return;

    const onScroll = () => {
      const scrollMarginTop = header.getBoundingClientRect().top ?? 0;
      const bottom = columnsEl.getBoundingClientRect().bottom ?? 0;

      console.log('scroll', scrollMarginTop, bottom);
      if (scrollMarginTop <= 48 && bottom - PADDING_END >= 48) {
        stickyHeader.style.opacity = '1';
        stickyHeader.style.pointerEvents = 'auto';
      } else {
        stickyHeader.style.opacity = '0';
        stickyHeader.style.pointerEvents = 'none';
      }
    };

    onScroll();
    verticalScrollContainer.addEventListener('scroll', onScroll);
    return () => {
      verticalScrollContainer.removeEventListener('scroll', onScroll);
    };

  }, [ref, verticalScrollContainer]);

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
        onMouseEnter={() => {
          setIsHover(true);
        }}
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
          const scrollLeft = e.currentTarget.scrollLeft;

          const bottomScrollbar = bottomScrollbarRef.current;

          setTotalSize(e.currentTarget.scrollWidth);
          stickyHeaderRef.current?.scroll({
            left: scrollLeft,
            behavior: 'auto',
          });

          if (!bottomScrollbar) return;

          bottomScrollbar.scroll({
            left: scrollLeft,
            behavior: 'auto',
          });
        }}
      >
        <div
          className="flex flex-col h-full w-fit min-w-full"
        >
          <GroupHeader
            ref={headerRef}
            groupResult={groupResult}
            columns={columns}
            fieldId={fieldId}
          />
          <div className={'columns flex flex-1 w-fit min-w-full gap-2'}>
            {columns.map((data) => (
              <Column
                key={data.id}
                id={data.id}
                fieldId={fieldId}
                rows={groupResult.get(data.id) || []}
              />
            ))}
          </div>

        </div>
        <DatabaseStickyTopOverlay>
          <GroupStickyHeader
            ref={stickyHeaderRef}
            groupResult={groupResult}
            columns={columns}
            fieldId={fieldId}
            onScrollLeft={scrollLeft => {
              ref.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
          />
        </DatabaseStickyTopOverlay>
        <DatabaseStickyBottomOverlay scrollElement={verticalScrollContainer}>
          <DatabaseStickyHorizontalScrollbar
            onScrollLeft={scrollLeft => {
              ref.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
            ref={bottomScrollbarRef}
            totalSize={totalSize}
            visible={isHover}
          />
        </DatabaseStickyBottomOverlay>
      </div>

    </BoardContext.Provider>
  );
};

export default Group;
