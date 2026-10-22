import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Column,
  RowMetaKey,
  RowMeta,
  useCellSelector,
  useDatabaseContext,
  useIsRowLoaded,
  useReadOnly,
  useRowCommentCount,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { GalleryCardPreview, GalleryCardSize, RowCoverType } from '@/application/types';
import { ReactComponent as DocumentIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as CommentIcon } from '@/assets/icons/titlebar_comment.svg';
import { useLatest } from '@/components/_shared/hooks/useLatest';
import { Cell } from '@/components/database/components/cell/Cell';
import { ClearSortingConfirm } from '@/components/database/components/sorts/ClearSortingConfirm';
import { ListCell } from '@/components/database/list/ListCell';
import { cn } from '@/lib/utils';
import { clampCoverOffset } from '@/utils/cover';

import {
  GALLERY_CARD_THEME_CLASS_NAME,
  GALLERY_COVER_PLACEHOLDER_BACKGROUND_CLASS_NAME,
  GALLERY_TILE_PADDING,
  GALLERY_TITLE_SURFACE_BACKGROUND_CLASS_NAME,
  getGalleryCoverHeight,
  getGalleryMinimumCardHeight,
} from './gallery.constants';
import GalleryCardToolbar from './GalleryCardToolbar';
import GalleryPreview from './GalleryPreview';
import GalleryRowIcon from './GalleryRowIcon';
import { useGalleryHasSorts } from './GallerySortState';
import { useGalleryReposition } from './GalleryViewContext';

const primaryCellStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '20px',
  maxWidth: '100%',
  minHeight: 20,
  overflow: 'hidden',
  textAlign: 'left',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const propertyCellStyle: CSSProperties = {
  alignItems: 'center',
  color: 'var(--text-primary)',
  display: 'flex',
  fontSize: 12,
  lineHeight: '18px',
  maxWidth: '100%',
  minHeight: 20,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
};

const GALLERY_PREVIEW_ROOT_MARGIN = '400px 0px';
const galleryCardClassName = cn(
  GALLERY_CARD_THEME_CLASS_NAME,
  'group/gallery-card relative flex h-full w-full flex-col overflow-hidden rounded-[10px] border bg-[var(--gallery-card-surface)]',
  'border-border-primary transition-[box-shadow,transform] ease-out [transition-duration:120ms] motion-reduce:transition-none',
  'focus-within:shadow-dialog hover:shadow-dialog'
);

function useGalleryPreviewNearViewport(tileRef: React.MutableRefObject<HTMLDivElement | null>): boolean {
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const element = tileRef.current;

    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: GALLERY_PREVIEW_ROOT_MARGIN }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [tileRef]);

  return nearViewport;
}

function useGalleryCardDnd({
  dragRef,
  enabled,
  onDropRow,
  rowId,
  tileRef,
}: {
  dragRef: React.MutableRefObject<HTMLButtonElement | null>;
  enabled: boolean;
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
  rowId: string;
  tileRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const hasSorts = useGalleryHasSorts();
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clearSortsOpen, setClearSortsOpen] = useState(false);
  const pendingDropRef = useRef<(() => void) | null>(null);
  const ignoreClickRef = useRef(false);
  const requestMove = useCallback(
    (move: () => void) => {
      if (hasSorts) {
        pendingDropRef.current = move;
        setClearSortsOpen(true);
      } else {
        move();
      }
    },
    [hasSorts]
  );

  useEffect(() => {
    const dragElement = dragRef.current;
    const tileElement = tileRef.current;

    if (!enabled || !dragElement || !tileElement || !onDropRow) return;

    return combine(
      draggable({
        // The semantic opener covers the card surface. Register it as the
        // native draggable so pointer dragging still starts from the card,
        // while elevated property controls remain independently operable.
        element: dragElement,
        getInitialData: () => ({ type: 'database-gallery-row', rowId }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          if (!nativeSetDragImage) return;

          const preview = tileElement.cloneNode(true) as HTMLElement;
          const { height, width } = tileElement.getBoundingClientRect();

          preview.setAttribute('aria-hidden', 'true');
          preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
          Object.assign(preview.style, {
            height: `${height}px`,
            left: '-10000px',
            opacity: '0.85',
            pointerEvents: 'none',
            position: 'fixed',
            top: '0',
            width: `${width}px`,
          });
          document.body.append(preview);
          nativeSetDragImage(preview, width / 2, height / 2);
          window.setTimeout(() => preview.remove(), 0);
        },
        onDragStart: () => {
          ignoreClickRef.current = true;
          setDragging(true);
        },
        onDrop: ({ location }) => {
          setDragging(false);
          window.setTimeout(() => {
            ignoreClickRef.current = false;
          }, 0);

          const target = location.current.dropTargets[0];

          if (!target || target.data.type !== 'database-gallery-row') return;

          const edge = extractClosestEdge(target.data);
          const targetRowId = target.data.rowId;

          if ((edge !== 'left' && edge !== 'right') || typeof targetRowId !== 'string' || targetRowId === rowId) {
            return;
          }

          requestMove(() => onDropRow(rowId, targetRowId, edge));
        },
      }),
      dropTargetForElements({
        element: tileElement,
        canDrop: ({ source }) => source.data.type === 'database-gallery-row' && source.data.rowId !== rowId,
        getData: ({ input, element: targetElement }) =>
          attachClosestEdge(
            { type: 'database-gallery-row', rowId },
            { allowedEdges: ['left', 'right'], element: targetElement, input }
          ),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => {
          setClosestEdge(null);
        },
      })
    );
  }, [dragRef, enabled, onDropRow, requestMove, rowId, tileRef]);

  return {
    clearSortsDialog: clearSortsOpen ? (
      <ClearSortingConfirm
        onClose={() => {
          pendingDropRef.current = null;
          setClearSortsOpen(false);
        }}
        onRemoved={() => {
          pendingDropRef.current?.();
          pendingDropRef.current = null;
        }}
        open
      />
    ) : null,
    closestEdge,
    dragging,
    ignoreClickRef,
    requestMove,
  };
}

function GalleryTitle({
  editing,
  field,
  id,
  meta,
  rowId,
  setEditing,
}: {
  editing: boolean;
  field: Column;
  id: string;
  meta: RowMeta | null | undefined;
  rowId: string;
  setEditing: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const cell = useCellSelector({ fieldId: field.fieldId, rowId });
  const commentCount = useRowCommentCount(rowId);
  const isRowLoaded = useIsRowLoaded(rowId);
  const indicator = meta?.icon ? 'icon' : meta?.isEmptyDocument === false ? 'document' : 'none';
  const hasTitle = typeof cell?.data === 'string' ? cell.data.trim().length > 0 : Boolean(cell?.data);
  const cellStyle = useMemo(
    () => ({
      ...primaryCellStyle,
      color: hasTitle ? 'var(--gallery-card-title)' : 'var(--gallery-card-hint)',
      letterSpacing: '0.07px',
    }),
    [hasTitle]
  );

  return (
    <div
      className='gallery-card-title flex h-5 min-w-0 items-center text-sm font-semibold text-[var(--gallery-card-title)]'
      data-primary-indicator={indicator}
      data-testid={`gallery-card-title-${rowId}`}
      id={id}
    >
      {indicator === 'icon' ? (
        <GalleryRowIcon className='mr-1.5' icon={meta?.icon ?? ''} />
      ) : indicator === 'document' ? (
        <DocumentIcon
          aria-hidden='true'
          className='mr-1.5 h-5 w-5 shrink-0 text-text-secondary'
          data-testid={`gallery-row-document-icon-${rowId}`}
        />
      ) : null}

      <div className='min-w-0 flex-1 overflow-hidden'>
        {isRowLoaded ? (
          <Cell
            cell={cell || undefined}
            editing={editing}
            fieldId={field.fieldId}
            placeholder={indicator === 'none' ? t('grid.row.titlePlaceholder') : ''}
            readOnly={!editing}
            rowId={rowId}
            setEditing={setEditing}
            style={cellStyle}
            wrap={false}
          />
        ) : (
          <span
            aria-label={t('grid.row.loading', 'Loading row')}
            className='block h-3.5 w-3.5 animate-spin rounded-full border border-border-primary border-t-fill-theme-thick'
            role='status'
          />
        )}
      </div>

      {commentCount > 0 ? (
        <span
          aria-label={t('gallery.commentCount', { count: commentCount, defaultValue: `${commentCount} comments` })}
          className='ml-1 flex shrink-0 items-center gap-0.5 text-xs text-[var(--gallery-card-hint)]'
          data-testid={`gallery-row-comment-count-${rowId}`}
        >
          <CommentIcon aria-hidden='true' className='h-3.5 w-3.5' />
          {commentCount}
        </span>
      ) : null}
    </div>
  );
}

function GalleryProperty({ field, rowId }: { field: Column; rowId: string }) {
  const cell = useCellSelector({ fieldId: field.fieldId, rowId });

  return (
    <div
      className='min-w-0 max-w-full overflow-hidden text-text-primary'
      data-field-id={field.fieldId}
      data-testid={`gallery-field-${field.fieldId}-${rowId}`}
    >
      <ListCell cell={cell} field={field} rowId={rowId} style={propertyCellStyle} wrap showPersonNames />
    </div>
  );
}

export interface GalleryCoverRepositionSession {
  /** The cover being repositioned; a remote cover change ends the session. */
  data: string;
  initialOffset: number;
}

/**
 * The card's cover, with the drag-to-reposition preview kept local so pointer
 * moves re-render only this subtree. The live offset is mirrored into
 * `liveOffsetRef` for the parent to persist on save.
 */
function GalleryCardCover({
  cardPreview,
  coverFieldId,
  coverHeight,
  fitImage,
  liveOffsetRef,
  meta,
  previewNearViewport,
  rowId,
  session,
}: {
  cardPreview: GalleryCardPreview;
  coverFieldId?: string;
  coverHeight: number;
  fitImage: boolean;
  liveOffsetRef: React.MutableRefObject<number>;
  meta: RowMeta | null | undefined;
  previewNearViewport: boolean;
  rowId: string;
  /** Set while this card repositions its cover. */
  session: GalleryCoverRepositionSession | null;
}) {
  const { t } = useTranslation();
  const coverRef = useRef<HTMLDivElement>(null);
  const pointerY = useRef<number | null>(null);
  const [draft, setDraft] = useState<{ session: GalleryCoverRepositionSession; offset: number } | null>(null);
  const repositioning = session !== null;
  const offset = session ? (draft?.session === session ? draft.offset : session.initialOffset) : undefined;
  const moveBy = (delta: number) => {
    if (!session) return;
    const next = clampCoverOffset(liveOffsetRef.current + delta);

    liveOffsetRef.current = next;
    setDraft({ session, offset: next });
  };

  useEffect(() => {
    if (session) coverRef.current?.focus();
  }, [session]);

  return (
    <div
      ref={coverRef}
      className={cn(
        'relative w-full shrink-0 overflow-hidden',
        repositioning ? 'z-20 cursor-grab touch-none select-none active:cursor-grabbing' : 'pointer-events-none'
      )}
      style={{ height: coverHeight }}
      data-testid={`gallery-cover-${rowId}`}
      role={repositioning ? 'slider' : undefined}
      tabIndex={repositioning ? 0 : undefined}
      aria-label={repositioning ? t('document.plugins.cover.repositionCover') : undefined}
      aria-orientation={repositioning ? 'vertical' : undefined}
      aria-valuemin={repositioning ? -1 : undefined}
      aria-valuemax={repositioning ? 1 : undefined}
      aria-valuenow={repositioning ? offset : undefined}
      onPointerDown={(event) => {
        if (!repositioning || event.button !== 0) return;
        event.stopPropagation();
        pointerY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (!repositioning || pointerY.current === null) return;
        const delta = -(event.clientY - pointerY.current) / (coverHeight / 2);

        pointerY.current = event.clientY;
        moveBy(delta);
      }}
      onPointerUp={() => {
        pointerY.current = null;
      }}
      onPointerCancel={() => {
        pointerY.current = null;
      }}
      onKeyDown={(event) => {
        if (!repositioning || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        moveBy(event.key === 'ArrowUp' ? 0.1 : -0.1);
      }}
    >
      {previewNearViewport ? (
        <GalleryPreview
          coverFieldId={coverFieldId}
          fitImage={fitImage}
          meta={meta}
          preview={cardPreview}
          offset={offset}
          rowId={rowId}
        />
      ) : (
        <div
          aria-hidden='true'
          className={cn(
            'gallery-card-cover-placeholder h-full w-full overflow-hidden',
            GALLERY_COVER_PLACEHOLDER_BACKGROUND_CLASS_NAME
          )}
          data-gallery-preview={cardPreview}
          data-testid={`gallery-card-preview-${rowId}`}
        />
      )}
      {repositioning ? (
        <span className='pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white opacity-40 backdrop-blur-sm'>
          {t('document.plugins.cover.dragImageToReposition')}
        </span>
      ) : null}
    </div>
  );
}

export interface GalleryCardProps {
  cardPreview: GalleryCardPreview;
  cardSize: GalleryCardSize;
  compactMode?: boolean;
  occurrenceId?: string;
  coverFieldId?: string;
  fields: Column[];
  fitImage: boolean;
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
  onKeyboardMoveRow?: (rowId: string, direction: -1 | 1) => void;
  reorderable: boolean;
  rowId: string;
}

export const GalleryCard = memo(function GalleryCard({
  cardPreview,
  cardSize,
  compactMode = false,
  occurrenceId,
  coverFieldId,
  fields,
  fitImage,
  onDropRow,
  onKeyboardMoveRow,
  reorderable,
  rowId,
}: GalleryCardProps) {
  const { t } = useTranslation();
  const dragRef = useRef<HTMLButtonElement | null>(null);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const readOnly = useReadOnly();
  const { bindRowSync, navigateToRow } = useDatabaseContext();
  const meta = useRowMetaSelector(rowId);
  const updateMeta = useUpdateRowMetaDispatch(rowId);
  const repositionController = useGalleryReposition();
  const repositionId = useRef(Symbol('gallery-cover')).current;
  const [repositionSession, setRepositionSession] = useState<GalleryCoverRepositionSession | null>(null);
  // GalleryCardCover keeps the drag preview; the parent only reads the final offset on save.
  const liveOffset = useRef(0);
  const canReposition =
    !readOnly &&
    cardPreview === GalleryCardPreview.PageCover &&
    meta?.cover?.cover_type === RowCoverType.FileCover &&
    Boolean(meta.cover.data);
  const repositioning = canReposition && repositionSession?.data === meta?.cover?.data;
  const cancelReposition = () => {
    repositionController?.end(repositionId);
    setRepositionSession(null);
  };

  const saveReposition = () => {
    if (repositioning && meta?.cover) {
      updateMeta(RowMetaKey.CoverId, JSON.stringify({ ...meta.cover, offset: liveOffset.current }));
    }

    cancelReposition();
  };

  const saveRepositionRef = useLatest(saveReposition);

  useEffect(() => () => repositionController?.end(repositionId), [repositionController, repositionId]);
  const primaryField = useMemo(() => fields.find((field) => field.isPrimary) ?? fields[0], [fields]);
  const propertyFields = useMemo(() => fields.filter((field) => !field.isPrimary), [fields]);
  const dnd = useGalleryCardDnd({
    dragRef,
    enabled: reorderable && !readOnly && !repositioning,
    onDropRow,
    rowId,
    tileRef,
  });
  const previewNearViewport = useGalleryPreviewNearViewport(tileRef);

  useEffect(() => {
    if (bindRowSync && rowId) bindRowSync(rowId);
  }, [bindRowSync, rowId]);

  const navigateToRowDetail = useCallback(() => {
    setEditing(false);
    navigateToRow?.(rowId);
  }, [navigateToRow, rowId]);

  const coverHeight = getGalleryCoverHeight(cardSize);
  const minimumHeight = getGalleryMinimumCardHeight(cardSize);
  const tileMinimumHeight = minimumHeight + GALLERY_TILE_PADDING * 2;
  const openLabelId = `gallery-card-open-label-${occurrenceId ?? rowId}`;
  const titleLabelId = `gallery-card-title-label-${occurrenceId ?? rowId}`;

  return (
    <>
      <div
        className={cn(
          'relative h-full transition-transform ease-out [transition-duration:120ms] motion-reduce:transition-none',
          dnd.dragging && 'select-none opacity-25'
        )}
        data-row-id={rowId}
        data-testid={`gallery-tile-${rowId}`}
        ref={tileRef}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: `auto ${tileMinimumHeight}px`,
          minHeight: tileMinimumHeight,
        }}
      >
        <div
          className={cn(galleryCardClassName, dnd.closestEdge && 'scale-[0.98]')}
          data-testid={`gallery-card-${rowId}`}
          style={{ minHeight: minimumHeight }}
          onBlur={(event) => {
            if (repositioning && !event.currentTarget.contains(event.relatedTarget)) cancelReposition();
          }}
          onKeyDown={(event) => {
            if (repositioning && event.key === 'Escape') {
              event.stopPropagation();
              cancelReposition();
            }
          }}
        >
          <button
            aria-description={
              reorderable
                ? t('gallery.reorderHint', {
                    defaultValue: 'Use Alt plus Left or Right Arrow to move this card',
                  })
                : undefined
            }
            aria-keyshortcuts={reorderable ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
            aria-labelledby={`${openLabelId} ${titleLabelId}`}
            className='absolute inset-0 z-10 cursor-pointer rounded-[10px] bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-theme-thick'
            data-testid={`gallery-card-open-${rowId}`}
            onClick={(event) => {
              event.stopPropagation();
              if (dnd.ignoreClickRef.current || repositioning) return;
              navigateToRowDetail();
            }}
            onKeyDown={(event) => {
              if (!reorderable || !event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;

              event.preventDefault();
              event.stopPropagation();
              dnd.requestMove(() => onKeyboardMoveRow?.(rowId, event.key === 'ArrowLeft' ? -1 : 1));
            }}
            ref={dragRef}
            type='button'
          >
            <span className='sr-only' id={openLabelId}>
              {t('gallery.openRow', { defaultValue: 'Open row' })}
            </span>
          </button>

          <GalleryCardCover
            cardPreview={cardPreview}
            coverFieldId={coverFieldId}
            coverHeight={coverHeight}
            fitImage={fitImage}
            liveOffsetRef={liveOffset}
            meta={meta}
            previewNearViewport={previewNearViewport}
            rowId={rowId}
            session={repositioning ? repositionSession : null}
          />

          <div
            className={cn(
              'gallery-card-title-surface pointer-events-none relative z-20 flex min-h-8 flex-1 flex-col p-3',
              editing && 'pointer-events-auto',
              '[&_[contenteditable=true]]:pointer-events-auto [&_[role=button]]:pointer-events-auto [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_label]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto',
              GALLERY_TITLE_SURFACE_BACKGROUND_CLASS_NAME
            )}
            data-testid={`gallery-card-title-surface-${rowId}`}
          >
            {primaryField ? (
              <GalleryTitle
                editing={editing}
                field={primaryField}
                id={titleLabelId}
                meta={meta}
                rowId={rowId}
                setEditing={setEditing}
              />
            ) : null}

            {propertyFields.length > 0 ? (
              <div
                className={cn(
                  'mt-1 flex min-w-0 gap-y-2 text-xs',
                  compactMode ? 'flex-wrap items-center gap-x-1' : 'flex-col items-start'
                )}
                data-compact={compactMode}
                data-testid={`gallery-card-properties-${rowId}`}
              >
                {propertyFields.map((field) => (
                  <GalleryProperty field={field} key={field.fieldId} rowId={rowId} />
                ))}
              </div>
            ) : null}
          </div>

          <GalleryCardToolbar
            onEdit={() => setEditing(true)}
            onPeek={navigateToRow ? navigateToRowDetail : undefined}
            onReposition={
              canReposition
                ? () => {
                    const initialOffset = clampCoverOffset(meta.cover!.offset);

                    liveOffset.current = initialOffset;
                    repositionController?.begin({ id: repositionId, save: () => saveRepositionRef.current() });
                    setRepositionSession({ data: meta.cover!.data, initialOffset });
                  }
                : undefined
            }
            repositioning={repositioning}
            onCancelReposition={cancelReposition}
            onSaveReposition={saveReposition}
            readOnly={readOnly}
            rowId={rowId}
          />
        </div>

        {dnd.closestEdge ? (
          <div
            aria-hidden='true'
            className='absolute bottom-2 top-2 z-30 w-[3px] rounded-[2px] bg-[rgba(0,188,240,0.9)]'
            data-testid='gallery-drop-indicator'
            style={dnd.closestEdge === 'left' ? { left: 0 } : { right: 0 }}
          />
        ) : null}
      </div>
      {dnd.clearSortsDialog}
    </>
  );
});

export default GalleryCard;
