import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PADDING_END, useDatabaseContext, useReadOnly, useRowsByGroup } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { useBoardActions } from '@/components/database/board/BoardProvider';
import { BoardDragContext } from '@/components/database/components/board/drag-and-drop/board-context';
import { useColumnsDrag } from '@/components/database/components/board/drag-and-drop/useColumnsDrag';
import Columns from '@/components/database/components/board/group/Columns';
import GroupStickyHeader from '@/components/database/components/board/group/GroupStickyHeader';
import { DeleteRowConfirm } from '@/components/database/components/database-row/DeleteRowConfirm';
import DatabaseStickyBottomOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyBottomOverlay';
import DatabaseStickyHorizontalScrollbar from '@/components/database/components/sticky-overlay/DatabaseStickyHorizontalScrollbar';
import DatabaseStickyTopOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay';
import { getScrollParent } from '@/components/global-comment/utils';

import { useNavigationKey } from './useNavigationKey';

export interface GroupProps {
  groupId: string;
}

export const Group = ({ groupId }: GroupProps) => {
  const { columns, groupResult, fieldId, notFound } = useRowsByGroup(groupId);
  const { t } = useTranslation();
  const context = useDatabaseContext();
  const { paddingStart, paddingEnd, navigateToRow } = context;

  const readOnly = useReadOnly();
  const getCards = useCallback(
    (columnId: string) => {
      return groupResult.get(columnId);
    },
    [groupResult]
  );
  const onNewCard = useNewRowDispatch();
  const { setEditingCardId, setSelectedCardIds } = useBoardActions();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deleteRowIdsRef = useRef<string[]>([]);

  const onDeleteCards = useCallback((ids: string[]) => {
    const rowIds = ids.map((id) => id.split('/')[1]);

    deleteRowIdsRef.current = rowIds;
    setDeleteConfirm(true);
  }, []);

  const onEnter = useCallback(
    (id: string) => {
      if (!navigateToRow) return;
      const rowId = id.split('/')[1];

      navigateToRow(rowId);
    },
    [navigateToRow]
  );

  useNavigationKey(element, {
    onDelete: onDeleteCards,
    onEnter,
  });

  const addCardBefore = useCallback(
    async (columnId: string) => {
      if (!fieldId) return;
      const cellsData = {
        [fieldId]: columnId,
      };

      const rowId = await onNewCard({ cellsData });

      if (!rowId) return;

      setEditingCardId(`${columnId}/${rowId}`);
    },
    [fieldId, onNewCard, setEditingCardId]
  );

  const { contextValue, scrollableRef: ref } = useColumnsDrag(groupId, columns, getCards, fieldId);

  const bottomScrollbarRef = useRef<HTMLDivElement>(null);
  const [isHover, setIsHover] = useState(false);
  const handleMouseEnter = useCallback(() => setIsHover(true), []);
  const handleMouseLeave = useCallback(() => setIsHover(false), []);
  const [verticalScrollContainer, setVerticalScrollContainer] = useState<HTMLElement | null>(null);
  const getVerticalScrollContainer = useCallback((el: HTMLDivElement) => {
    return (el.closest('.appflowy-scroll-container') || getScrollParent(el)) as HTMLElement;
  }, []);
  const [totalSize, setTotalSize] = useState<number>(0);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);

  const handleRefCallback = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (!el) return;
    const container = getVerticalScrollContainer(el);

    if (!container) return;
    setVerticalScrollContainer(container);
    setElement(el);
  }, [getVerticalScrollContainer, ref]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
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
  }, []);

  const handleScrollLeft = useCallback((scrollLeft: number) => {
    ref.current?.scrollTo({
      left: scrollLeft,
      behavior: 'auto',
    });
  }, [ref]);

  const handleCloseDeleteConfirm = useCallback(() => {
    setDeleteConfirm(false);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedCardIds([]);
  }, [setSelectedCardIds]);

  // Auto-scroll for card dragging (registered once at Group level)
  useEffect(() => {
    if (!verticalScrollContainer || readOnly) return;

    const cleanup = autoScrollForElements({
      element: verticalScrollContainer,
      canScroll: ({ source }) => source.data.instanceId === contextValue.instanceId && source.data.type === 'card',
    });

    return cleanup;
  }, [verticalScrollContainer, readOnly, contextValue.instanceId]);

  // Compute initial sticky-header visibility before first paint to prevent
  // either a flash of duplicate headers (not scrolled) or a missing header
  // (already scrolled past threshold, e.g. scroll restoration).
  useLayoutEffect(() => {
    const stickyHeader = stickyHeaderRef.current;

    if (!stickyHeader) return;

    const inner = innerRef.current;
    const columnsEl = ref.current;

    if (inner && columnsEl) {
      const scrollMarginTop = inner.getBoundingClientRect().top ?? 0;
      const bottom = columnsEl.getBoundingClientRect().bottom ?? 0;

      if (scrollMarginTop <= 48 && bottom - PADDING_END >= 48) {
        stickyHeader.style.opacity = '1';
        stickyHeader.style.pointerEvents = 'auto';
        return;
      }
    }

    stickyHeader.style.opacity = '0';
    stickyHeader.style.pointerEvents = 'none';
    // fieldId gates whether the full JSX (including the portal sticky header) renders.
    // Re-run when it transitions from null to ensure we set opacity before first paint.
  }, [ref, fieldId]);

  // Sticky header scroll listener
  useEffect(() => {
    const inner = innerRef.current;
    const columnsEl = ref.current;

    if (!verticalScrollContainer || !inner || !columnsEl) return;

    const stickyHeader = stickyHeaderRef.current;

    if (!stickyHeader) return;

    const onScroll = () => {
      const scrollMarginTop = inner.getBoundingClientRect().top ?? 0;
      const bottom = columnsEl.getBoundingClientRect().bottom ?? 0;

      if (scrollMarginTop <= 48 && bottom - PADDING_END >= 48) {
        stickyHeader.style.opacity = '1';
        stickyHeader.style.pointerEvents = 'auto';
      } else {
        stickyHeader.style.opacity = '0';
        stickyHeader.style.pointerEvents = 'none';
      }
    };

    onScroll();
    const scrollListenerOptions: AddEventListenerOptions = { passive: true };

    verticalScrollContainer.addEventListener('scroll', onScroll, scrollListenerOptions);
    return () => {
      verticalScrollContainer.removeEventListener('scroll', onScroll, scrollListenerOptions);
    };
  }, [ref, verticalScrollContainer]);

  if (notFound) {
    return (
      <div className={'mt-[10%] flex h-full w-full flex-col items-center gap-2 text-text-secondary'}>
        <div className={'text-sm font-medium'}>{t('board.noGroup')}</div>
        <div className={'text-xs'}>{t('board.noGroupDesc')}</div>
      </div>
    );
  }

  if (!fieldId) return null;
  if (readOnly && columns.length === 0) return null;

  return (
    <BoardDragContext.Provider value={contextValue}>
      <div
        onMouseEnter={handleMouseEnter}
        tabIndex={0}
        onMouseLeave={handleMouseLeave}
        ref={handleRefCallback}
        className={'appflowy-custom-scroller h-full min-h-0 overflow-x-auto px-24 focus:outline-none max-sm:!px-6'}
        style={{
          paddingLeft: paddingStart,
          paddingRight: paddingEnd,
          scrollBehavior: 'auto',
        }}
        onScroll={handleScroll}
      >
        <div className='flex h-full min-h-0 w-fit min-w-full flex-col'>
          <Columns
            groupId={groupId}
            fieldId={fieldId}
            groupResult={groupResult}
            columns={columns}
            ref={innerRef}
            addCardBefore={addCardBefore}
          />
        </div>
        <DatabaseStickyTopOverlay>
          <GroupStickyHeader
            groupId={groupId}
            addCardBefore={addCardBefore}
            ref={stickyHeaderRef}
            groupResult={groupResult}
            columns={columns}
            fieldId={fieldId}
            onScrollLeft={handleScrollLeft}
          />
        </DatabaseStickyTopOverlay>
        <DatabaseStickyBottomOverlay scrollElement={verticalScrollContainer}>
          <DatabaseStickyHorizontalScrollbar
            onScrollLeft={handleScrollLeft}
            ref={bottomScrollbarRef}
            totalSize={totalSize}
            visible={isHover}
          />
        </DatabaseStickyBottomOverlay>
      </div>
      {deleteConfirm && (
        <DeleteRowConfirm
          open={deleteConfirm}
          onClose={handleCloseDeleteConfirm}
          rowIds={deleteRowIdsRef.current || []}
          onDeleted={handleDeleted}
        />
      )}
    </BoardDragContext.Provider>
  );
};

export default Group;
