import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldVisibility,
  Row,
  useDatabaseContext,
  useDatabaseGroupFieldIdSelector,
  useFieldsSelector,
  useGalleryLayoutSettings,
  useReadOnly,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import { useReorderRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
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
import GalleryNewRow from './GalleryNewRow';
import { GallerySortSubscription } from './GallerySortState';

import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

const GALLERY_FIELD_VISIBILITIES = [
  FieldVisibility.AlwaysShown,
  FieldVisibility.HideWhenEmpty,
  FieldVisibility.AlwaysHidden,
];

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
  const allFields = useFieldsSelector(GALLERY_FIELD_VISIBILITIES);
  const groupFieldId = useDatabaseGroupFieldIdSelector();
  const fields = useMemo(
    () =>
      allFields.filter(
        (field) =>
          field.fieldId !== groupFieldId && (field.isPrimary || field.visibility !== FieldVisibility.AlwaysHidden)
      ),
    [allFields, groupFieldId]
  );
  const rowOrders = useRowOrdersSelector();
  const readOnly = useReadOnly();
  const settings = useGalleryLayoutSettings();
  const { query } = useDatabaseSearch();
  const { activeViewId, isDocumentBlock, onRendered, paddingEnd, paddingStart } = useDatabaseContext();
  const reorderRow = useReorderRowDispatch();
  const [visibleRowLimit, setVisibleRowLimit] = useState(GALLERY_INITIAL_ROW_LIMIT);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const rowOrdersRef = useRef(rowOrders);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardWidth = getGalleryCardWidth(settings.cardSize);
  const columnCount = useGalleryColumnCount(gridRef, cardWidth, rowOrders !== undefined);

  rowOrdersRef.current = rowOrders;

  useEffect(() => {
    setVisibleRowLimit(GALLERY_INITIAL_ROW_LIMIT);
  }, [activeViewId, isDocumentBlock]);

  useEffect(() => {
    if (rowOrders !== undefined) onRendered?.();
  }, [onRendered, rowOrders]);

  const searchActive = query.trim().length > 0;
  const visibleRows = useMemo(
    () => (searchActive ? rowOrders : rowOrders?.slice(0, visibleRowLimit)),
    [rowOrders, searchActive, visibleRowLimit]
  );
  const remainingRowCount = rowOrders && !searchActive ? Math.max(rowOrders.length - visibleRowLimit, 0) : 0;
  const loadMoreRows = useCallback(() => {
    setVisibleRowLimit((current) => current + GALLERY_LOAD_MORE_INCREMENT);
  }, []);

  useEffect(() => {
    const galleryElement = scrollContainerRef.current;
    const gridElement = gridRef.current;

    if (!galleryElement || !gridElement || isDocumentBlock || remainingRowCount === 0) return;

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
  }, [isDocumentBlock, loadMoreRows, remainingRowCount]);

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
    [reorderRow]
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
    [handleDropRow, t]
  );

  const effectivePaddingStart = paddingStart ?? GALLERY_DESKTOP_INLINE_PADDING;
  const effectivePaddingEnd = paddingEnd ?? GALLERY_DESKTOP_INLINE_PADDING;
  const containerClassName = cn(
    'database-gallery appflowy-custom-scroller min-h-0 w-full [color-scheme:light] [[data-dark-mode=true]_&]:[color-scheme:dark]',
    isDocumentBlock ? 'overflow-visible' : 'h-full flex-1 overflow-y-auto overflow-x-hidden'
  );

  if (rowOrders === undefined) {
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
      ref={gridRef}
      style={{
        gap: GALLERY_GRID_GAP,
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      }}
    >
      {visibleRows?.map((row: Row) => (
        <GalleryCard
          cardPreview={settings.cardPreview}
          cardSize={settings.cardSize}
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

  return (
    <div className={containerClassName} data-testid='database-gallery' ref={scrollContainerRef}>
      <div
        className='w-full'
        style={{ paddingInlineEnd: effectivePaddingEnd, paddingInlineStart: effectivePaddingStart }}
      >
        {readOnly ? galleryGrid : <GallerySortSubscription>{galleryGrid}</GallerySortSubscription>}
      </div>
      <span aria-live='polite' className='sr-only'>
        {reorderAnnouncement}
      </span>
    </div>
  );
}

export default Gallery;
