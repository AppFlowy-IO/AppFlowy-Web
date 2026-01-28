import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PADDING_END, useDatabaseContext, useReadOnly, useRowOrdersSelector, useRowsByGroup } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { useBoardContext } from '@/components/database/board/BoardProvider';
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
  const { paddingStart, paddingEnd, navigateToRow, ensureRowDoc } = context;
  const rowOrders = useRowOrdersSelector();

  // Ensure all row documents are loaded when Board mounts
  // This is critical for Board view which needs row docs to display cards
  // Use rowOrders which contains ALL row IDs, not just those in groups
  useEffect(() => {
    if (!ensureRowDoc || !rowOrders || rowOrders.length === 0) return;

    let cancelled = false;

    // Load all row documents in parallel
    rowOrders.forEach((row) => {
      const promise = ensureRowDoc(row.id);

      if (promise) {
        promise.catch((error: unknown) => {
          if (!cancelled) {
            console.error('[Group] Failed to ensure row doc:', error);
          }
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ensureRowDoc, rowOrders]);
  const readOnly = useReadOnly();
  const getCards = useCallback(
    (columnId: string) => {
      return groupResult.get(columnId);
    },
    [groupResult]
  );
  const onNewCard = useNewRowDispatch();
  const { setEditingCardId, setSelectedCardIds } = useBoardContext();
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
  const [verticalScrollContainer, setVerticalScrollContainer] = useState<HTMLElement | null>(null);
  const getVerticalScrollContainer = useCallback((el: HTMLDivElement) => {
    return (el.closest('.appflowy-scroll-container') || getScrollParent(el)) as HTMLElement;
  }, []);
  const [totalSize, setTotalSize] = useState<number>(0);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);

  // Auto-scroll for card dragging (registered once at Group level)
  useEffect(() => {
    if (!verticalScrollContainer || readOnly) return;

    const cleanup = autoScrollForElements({
      element: verticalScrollContainer,
      canScroll: ({ source }) => source.data.instanceId === contextValue.instanceId && source.data.type === 'card',
    });

    return cleanup;
  }, [verticalScrollContainer, readOnly, contextValue.instanceId]);

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
    verticalScrollContainer.addEventListener('scroll', onScroll);
    return () => {
      verticalScrollContainer.removeEventListener('scroll', onScroll);
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
        onMouseEnter={() => {
          setIsHover(true);
        }}
        tabIndex={0}
        onMouseLeave={() => setIsHover(false)}
        ref={(el) => {
          ref.current = el;
          if (!el) return;
          const container = getVerticalScrollContainer(el);

          if (!container) return;
          setVerticalScrollContainer(container);
          setElement(el);
        }}
        className={'appflowy-custom-scroller h-full overflow-x-auto px-24 focus:outline-none max-sm:!px-6'}
        style={{
          paddingLeft: paddingStart,
          paddingRight: paddingEnd,
          scrollBehavior: 'auto',
        }}
        onScroll={(e) => {
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
        <div className='flex h-full w-fit min-w-full flex-col'>
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
            onScrollLeft={(scrollLeft) => {
              ref.current?.scrollTo({
                left: scrollLeft,
                behavior: 'auto',
              });
            }}
          />
        </DatabaseStickyTopOverlay>
        <DatabaseStickyBottomOverlay scrollElement={verticalScrollContainer}>
          <DatabaseStickyHorizontalScrollbar
            onScrollLeft={(scrollLeft) => {
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
      {deleteConfirm && (
        <DeleteRowConfirm
          open={deleteConfirm}
          onClose={() => {
            setDeleteConfirm(false);
          }}
          rowIds={deleteRowIdsRef.current || []}
          onDeleted={() => {
            setSelectedCardIds([]);
          }}
        />
      )}
    </BoardDragContext.Provider>
  );
};

export default Group;
