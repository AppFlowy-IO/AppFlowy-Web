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
  const { paddingStart, paddingEnd, navigateToRow, ensureRow, populateRowFromCache, blobPrefetchComplete } =
    context;
  const rowOrders = useRowOrdersSelector();

  // Track visibility for lazy loading (rerender-move-effect-to-event pattern)
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observedContainerRef = useRef<HTMLDivElement | null>(null);

  // Store callbacks in refs to avoid triggering effect re-runs (advanced-use-latest pattern)
  const ensureRowRef = useRef(ensureRow);
  const populateRowFromCacheRef = useRef(populateRowFromCache);
  const loadedRowsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    ensureRowRef.current = ensureRow;
    populateRowFromCacheRef.current = populateRowFromCache;
  });

  // Set up intersection observer for lazy loading
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Once visible, stay visible (no need to unload)
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
        }
      },
      {
        // Load slightly before entering viewport for smoother UX
        rootMargin: '100px',
        threshold: 0,
      }
    );

    const container = containerRef.current;

    if (container) {
      observerRef.current.observe(container);
      observedContainerRef.current = container;
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Reset loaded rows and visibility when group changes
  useEffect(() => {
    loadedRowsRef.current.clear();
    setIsVisible(false);
  }, [groupId]);

  // Load row documents only when group becomes visible.
  // Try cached data first (fast), then fall back to ensureRow (WebSocket sync).
  // Uses Promise.all for parallel loading to avoid request waterfalls.
  useEffect(() => {
    // Only load when visible (lazy loading for off-screen groups)
    if (!isVisible || !rowOrders || rowOrders.length === 0) return;

    // Only load rows we haven't loaded yet (avoid re-loading on sort/filter changes)
    const rowsToLoad = rowOrders.filter((row) => !loadedRowsRef.current.has(row.id));

    if (rowsToLoad.length === 0) return;

    const loadRows = async () => {
      try {
        if (blobPrefetchComplete && populateRowFromCacheRef.current) {
          // Load all rows from cache in parallel
          const results = await Promise.all(
            rowsToLoad.map((row) => populateRowFromCacheRef.current!(row.id))
          );

          // Mark rows as loaded
          rowsToLoad.forEach((row) => loadedRowsRef.current.add(row.id));

          // Fall back to ensureRow for any rows not in cache
          if (ensureRowRef.current) {
            results.forEach((doc, index) => {
              if (!doc) {
                // Ignore errors - WebSocket sync provides fallback
                ensureRowRef.current!(rowsToLoad[index].id)?.catch(() => undefined);
              }
            });
          }
        } else if (ensureRowRef.current) {
          // No cache available, use ensureRow directly
          rowsToLoad.forEach((row) => {
            // Ignore errors - WebSocket sync provides fallback
            ensureRowRef.current!(row.id)?.catch(() => undefined);
            loadedRowsRef.current.add(row.id);
          });
        }
      } catch {
        // Silently handle errors - WebSocket sync will provide data as fallback
      }
    };

    void loadRows();
  }, [isVisible, blobPrefetchComplete, rowOrders]);

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
          containerRef.current = el;
          if (observedContainerRef.current && observerRef.current) {
            observerRef.current.unobserve(observedContainerRef.current);
          }

          observedContainerRef.current = el;
          if (el && observerRef.current) {
            observerRef.current.observe(el);
          }

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
