import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Row, useDatabaseContext, useGalleryLayoutSettings, useReadOnly } from '@/application/database-yjs';
import { useReorderRowDispatch } from '@/application/database-yjs/dispatch';
import { usePublishRowOrders } from '@/application/database-yjs/row-orders-store';
import type { YDoc } from '@/application/types';
import { ReactComponent as GalleryIcon } from '@/assets/icons/gallery.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useLatest } from '@/components/_shared/hooks/useLatest';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { useFeedSearch } from '@/components/database/feed/useFeedSearch';
import { ListGroupHeader } from '@/components/database/list/ListGroup';
import { cn } from '@/lib/utils';

import {
  GALLERY_DESKTOP_INLINE_PADDING,
  GALLERY_GRID_GAP,
  GALLERY_INITIAL_ROW_LIMIT,
  GALLERY_LOAD_MORE_INCREMENT,
  GALLERY_LOAD_MORE_THRESHOLD,
  GALLERY_MAX_COLUMNS,
  getGalleryCardWidth,
} from './gallery.constants';
import GalleryCard from './GalleryCard';
import { GalleryGroupFooter } from './GalleryGroupFooter';
import GalleryNewRow from './GalleryNewRow';
import { GallerySortSubscription } from './GallerySortState';
import { useGalleryFields } from './useGalleryFields';
import { useGalleryView } from './GalleryViewContext';

import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

/** The search index loads candidate rows independently of the mounted cards. */
const NO_CACHED_ROW_DOCS: Record<string, YDoc> = {};

function GalleryLoading() {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t('grid.row.loading', 'Loading rows')}
      className='flex w-full justify-center pt-[30px]'
      data-testid='gallery-loading'
      role='status'
    >
      <span className='h-9 w-9 animate-spin rounded-full border-[3px] border-border-primary border-t-fill-theme-thick motion-reduce:animate-none' />
    </div>
  );
}

/** Desktop shows this when a grouping field is set but no group is visible. */
function GalleryNoGroups({ fieldName }: { fieldName?: string }) {
  const { t } = useTranslation();

  return (
    <div
      className='flex w-full justify-center bg-surface-primary px-3 py-10'
      data-testid='gallery-no-groups'
      role='status'
    >
      <div className='flex max-w-[480px] flex-col items-center text-center'>
        <span className='flex h-24 w-24 items-center justify-center rounded-600 bg-surface-layer-01'>
          <GalleryIcon aria-hidden='true' className='h-12 w-12 text-icon-primary' />
        </span>
        <p className='mt-3 text-base font-semibold text-text-primary'>
          {t('gallery.noGroupsForField', { field: fieldName ?? t('board.groupBy') })}
        </p>
        <p className='mt-1.5 text-sm text-text-secondary'>{t('gallery.noGroupsHint')}</p>
      </div>
    </div>
  );
}

function GalleryLoadMore({ onLoadMore, remainingCount }: { onLoadMore: () => void; remainingCount: number }) {
  const { t } = useTranslation();

  return (
    <button
      className='mx-2 flex h-8 items-center justify-start gap-2 rounded-[6px] text-sm font-medium text-text-tertiary hover:bg-fill-content-hover focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      data-testid='gallery-load-more'
      onClick={onLoadMore}
      style={{ gridColumn: '1 / -1' }}
      type='button'
    >
      <PlusIcon aria-hidden='true' className='h-4 w-4 shrink-0' />
      {t('grid.row.loadMore')} ({remainingCount})
    </button>
  );
}

function useGalleryColumnCount(gridRef: React.RefObject<HTMLDivElement>, cardWidth: number, ready: boolean): number {
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    if (!ready) return;

    const element = gridRef.current;

    if (!element) return;

    const update = () => {
      const availableWidth = element.clientWidth;
      const next = Math.max(
        1,
        Math.min(GALLERY_MAX_COLUMNS, Math.floor(availableWidth / (cardWidth + GALLERY_GRID_GAP)))
      );

      setColumns((current) => (current === next ? current : next));
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);

    observer.observe(element);
    return () => observer.disconnect();
  }, [cardWidth, gridRef, ready]);

  return columns;
}

export function Gallery() {
  const { t } = useTranslation();
  const fields = useGalleryFields();
  const { grouping, compactMode } = useGalleryView();
  const rowOrders = grouping.rowOrders;
  const readOnly = useReadOnly();
  const settings = useGalleryLayoutSettings();
  const { query } = useDatabaseSearch();
  const primaryFieldId = useMemo(() => fields.find((field) => field.isPrimary)?.fieldId, [fields]);
  // Cards and peek navigation share the same search result, including metadata
  // properties such as Created By and Last Edited By.
  const matchingRows = useFeedSearch({
    rows: rowOrders,
    fields,
    primaryFieldId,
    cachedRowDocs: NO_CACHED_ROW_DOCS,
    query,
  });

  const matchingRowIds = useMemo(() => new Set(matchingRows?.map((row) => row.id)), [matchingRows]);
  const visibleGroups = useMemo(
    () =>
      grouping.visibleGroups
        .map((group) => ({
          ...group,
          rows: group.rows.filter((row) => matchingRowIds.has(row.id)),
        }))
        .filter((group) => !query.trim() || group.rows.length > 0),
    [grouping.visibleGroups, matchingRowIds, query]
  );
  const navigationRows = useMemo(() => {
    if (!grouping.isGrouped) return matchingRows;
    if (!grouping.ready || !matchingRows) return undefined;
    const seen = new Set<string>();

    return visibleGroups
      .flatMap((group) => (group.collapsed ? [] : group.rows))
      .filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
  }, [grouping.isGrouped, grouping.ready, matchingRows, visibleGroups]);

  usePublishRowOrders(navigationRows, true, { layout: 'gallery', query });
  const { activeViewId, isDocumentBlock, onRendered, paddingEnd, paddingStart } = useDatabaseContext();
  const reorderRow = useReorderRowDispatch();
  const [visibleRowLimit, setVisibleRowLimit] = useState(GALLERY_INITIAL_ROW_LIMIT);
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({});
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const rowOrdersRef = useLatest(rowOrders);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardWidth = getGalleryCardWidth(settings.cardSize);
  const columnCount = useGalleryColumnCount(
    gridRef,
    cardWidth,
    rowOrders !== undefined && (!grouping.isGrouped || grouping.ready)
  );

  useEffect(() => {
    setVisibleRowLimit(GALLERY_INITIAL_ROW_LIMIT);
    setGroupLimits({});
  }, [activeViewId, grouping.groupId, isDocumentBlock]);

  useEffect(() => {
    if (rowOrders !== undefined && grouping.ready) onRendered?.();
  }, [onRendered, rowOrders, grouping.ready]);

  const searchActive = query.trim().length > 0;
  const visibleRows = useMemo(
    () => (searchActive ? matchingRows : rowOrders?.slice(0, visibleRowLimit)),
    [matchingRows, rowOrders, searchActive, visibleRowLimit]
  );
  const remainingRowCount = rowOrders && !searchActive ? Math.max(rowOrders.length - visibleRowLimit, 0) : 0;
  const loadMoreRows = useCallback(() => {
    setVisibleRowLimit((current) => current + GALLERY_LOAD_MORE_INCREMENT);
  }, []);
  const loadMoreGroupRows = useCallback((groupId: string) => {
    setGroupLimits((current) => ({
      ...current,
      [groupId]: (current[groupId] ?? GALLERY_INITIAL_ROW_LIMIT) + GALLERY_LOAD_MORE_INCREMENT,
    }));
  }, []);

  useEffect(() => {
    const galleryElement = scrollContainerRef.current;
    const gridElement = gridRef.current;

    if (!galleryElement || !gridElement || isDocumentBlock || grouping.isGrouped || remainingRowCount === 0) return;

    const nearestPageScroller = galleryElement.closest('.appflowy-scroll-container');
    const scrollElement =
      galleryElement.scrollHeight > galleryElement.clientHeight
        ? galleryElement
        : nearestPageScroller instanceof HTMLElement
        ? nearestPageScroller
        : galleryElement;

    const handleScroll = () => {
      if (scrollElement.clientHeight <= 0) return;

      const distanceFromBottom =
        scrollElement === galleryElement
          ? scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
          : galleryElement.getBoundingClientRect().bottom - scrollElement.getBoundingClientRect().bottom;

      if (distanceFromBottom <= GALLERY_LOAD_MORE_THRESHOLD) loadMoreRows();
    };

    const listenerOptions: AddEventListenerOptions = { passive: true };
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            handleScroll();
          });

    scrollElement.addEventListener('scroll', handleScroll, listenerOptions);
    resizeObserver?.observe(scrollElement);
    if (scrollElement !== galleryElement) resizeObserver?.observe(galleryElement);
    resizeObserver?.observe(gridElement);
    handleScroll();

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll, listenerOptions);
      resizeObserver?.disconnect();
    };
  }, [isDocumentBlock, loadMoreRows, remainingRowCount, grouping.isGrouped]);

  const handleDropRow = useCallback(
    (sourceRowId: string, targetRowId: string, closestEdgeOfTarget: Edge) => {
      const currentRowOrders = rowOrdersRef.current;

      if (!currentRowOrders) return;

      const startIndex = currentRowOrders.findIndex((row) => row.id === sourceRowId);
      const indexOfTarget = currentRowOrders.findIndex((row) => row.id === targetRowId);

      if (startIndex < 0 || indexOfTarget < 0) return;

      const finishIndex = getReorderDestinationIndex({
        axis: 'horizontal',
        closestEdgeOfTarget,
        indexOfTarget,
        startIndex,
      });

      if (finishIndex === startIndex) return;

      const nextRows = reorder({ finishIndex, list: currentRowOrders, startIndex });
      const previousRowId = nextRows[finishIndex - 1]?.id;

      reorderRow(sourceRowId, previousRowId);
    },
    [reorderRow, rowOrdersRef]
  );

  const handleKeyboardMoveRow = useCallback(
    (rowId: string, direction: -1 | 1) => {
      const currentRows = rowOrdersRef.current;

      if (!currentRows) return;

      const currentIndex = currentRows.findIndex((row) => row.id === rowId);
      const target = currentRows[currentIndex + direction];

      if (currentIndex < 0 || !target) return;

      handleDropRow(rowId, target.id, direction < 0 ? 'left' : 'right');
      setReorderAnnouncement(
        t('gallery.rowMoved', {
          defaultValue: direction < 0 ? 'Row moved left' : 'Row moved right',
          direction: direction < 0 ? 'left' : 'right',
        })
      );
    },
    [handleDropRow, rowOrdersRef, t]
  );

  const effectivePaddingStart = paddingStart ?? GALLERY_DESKTOP_INLINE_PADDING;
  const effectivePaddingEnd = paddingEnd ?? GALLERY_DESKTOP_INLINE_PADDING;
  const containerClassName = cn(
    'database-gallery appflowy-custom-scroller min-h-0 w-full [color-scheme:light] [[data-dark-mode=true]_&]:[color-scheme:dark]',
    isDocumentBlock ? 'overflow-visible' : 'h-full flex-1 overflow-y-auto overflow-x-hidden'
  );

  if (rowOrders === undefined || (grouping.isGrouped && !grouping.ready)) {
    return (
      <div className={containerClassName} data-testid='database-gallery' ref={scrollContainerRef}>
        <GalleryLoading />
      </div>
    );
  }

  const galleryGrid = (
    <div
      className='grid w-full items-stretch'
      data-card-size={settings.cardSize}
      data-column-count={columnCount}
      data-testid='gallery-grid'
      style={{
        gap: GALLERY_GRID_GAP,
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      }}
    >
      {visibleRows?.map((row: Row) => (
        <GalleryCard
          cardPreview={settings.cardPreview}
          cardSize={settings.cardSize}
          compactMode={compactMode}
          coverFieldId={settings.coverFieldId}
          fields={fields}
          fitImage={settings.fitImage}
          key={row.id}
          onDropRow={handleDropRow}
          onKeyboardMoveRow={handleKeyboardMoveRow}
          reorderable={!readOnly && (visibleRows?.length ?? 0) > 1}
          rowId={row.id}
        />
      ))}

      {!readOnly ? <GalleryNewRow cardSize={settings.cardSize} /> : null}
      {remainingRowCount > 0 && isDocumentBlock ? (
        <GalleryLoadMore onLoadMore={loadMoreRows} remainingCount={remainingRowCount} />
      ) : null}
    </div>
  );

  // Each group pages on its own, so "Load more" always grows the group it was clicked in.
  const groupedGrid = grouping.isGrouped
    ? visibleGroups.map((group) => {
        const limit = groupLimits[group.id] ?? GALLERY_INITIAL_ROW_LIMIT;
        const rows = group.collapsed ? [] : group.rows.slice(0, limit);
        const remaining = group.rows.length - rows.length;

        return (
          <section key={group.id} className='mb-5' data-testid={`gallery-group-${group.id}`}>
            <ListGroupHeader
              className='h-10'
              fieldId={grouping.fieldId}
              fieldName={grouping.fieldName}
              fieldType={grouping.fieldType}
              group={group}
              groupConfigId={grouping.groupId}
              openAfterCreate
            />
            {!group.collapsed ? (
              <>
                <div
                  className='mt-2 grid items-stretch'
                  style={{ gap: GALLERY_GRID_GAP, gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
                >
                  {rows.map((row) => (
                    <GalleryCard
                      key={row.id}
                      rowId={row.id}
                      occurrenceId={`${group.id}-${row.id}`}
                      fields={fields}
                      cardSize={settings.cardSize}
                      compactMode={compactMode}
                      cardPreview={settings.cardPreview}
                      coverFieldId={settings.coverFieldId}
                      fitImage={settings.fitImage}
                      reorderable={false}
                    />
                  ))}
                  {remaining > 0 ? (
                    <GalleryLoadMore onLoadMore={() => loadMoreGroupRows(group.id)} remainingCount={remaining} />
                  ) : null}
                </div>
                {!readOnly ? (
                  <div
                    className='mt-4 grid'
                    style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`, gap: GALLERY_GRID_GAP }}
                  >
                    <GalleryGroupFooter fieldId={grouping.fieldId} groupId={group.id} />
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })
    : null;

  const showNoGroups = grouping.isGrouped && !searchActive && visibleGroups.length === 0;
  const content = grouping.isGrouped
    ? showNoGroups
      ? <GalleryNoGroups fieldName={grouping.fieldName} />
      : groupedGrid
    : galleryGrid;

  return (
    <div className={containerClassName} data-testid='database-gallery' ref={scrollContainerRef}>
      <div
        className='w-full py-2'
        style={{ paddingInlineEnd: effectivePaddingEnd, paddingInlineStart: effectivePaddingStart }}
      >
        <div ref={gridRef} data-testid='gallery-content'>
          {readOnly ? content : <GallerySortSubscription>{content}</GallerySortSubscription>}
        </div>
      </div>
      <span aria-live='polite' className='sr-only'>
        {reorderAnnouncement}
      </span>
    </div>
  );
}

export default Gallery;
