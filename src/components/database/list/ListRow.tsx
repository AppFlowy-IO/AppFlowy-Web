import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  useCellSelector,
  useDatabaseContext,
  useIsRowLoaded,
  useReadOnly,
  useRowCommentCount,
  useRowMetaSelector,
} from '@/application/database-yjs';
import type { Column, Row } from '@/application/database-yjs';
import { ReactComponent as DocumentIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as CommentIcon } from '@/assets/icons/titlebar_comment.svg';
import { Cell } from '@/components/database/components/cell/Cell';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { type Edge, useRowDnd as useListRowDnd } from '@/components/database/components/drag-and-drop/useRowDnd';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';

import { LIST_ROW_ACTIONS_WIDTH, LIST_ROW_HEIGHT, LIST_ROW_NARROW_HEIGHT } from './list.constants';
import {
  getListLeadingFieldMinWidth,
  isListRowInteractiveTarget,
  resolveListPrimaryIndicator,
  splitListFields,
} from './list.utils';
import { ListCell } from './ListCell';
import { ListRowActions } from './ListRowActions';
import { useListRowLayout } from './ListRowLayout';
import { ListRowPeekButton } from './ListRowPeekButton';
import { useListHasSorts } from './ListSortState';

// Desktop desktopListCardCellStyleMap: caption.standard (12/18) in text-primary.
const listCellStyle: CSSProperties = {
  alignItems: 'center',
  color: 'var(--text-primary)',
  display: 'flex',
  fontSize: 12,
  lineHeight: '18px',
  maxWidth: '100%',
  minHeight: 20,
  overflow: 'hidden',
  textAlign: 'left',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const listPrimaryCellStyle: CSSProperties = {
  ...listCellStyle,
  color: 'var(--text-primary)',
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '20px',
};

function ListPropertyCell({ field, leading, rowId }: { field: Column; leading?: boolean; rowId: string }) {
  const cell = useCellSelector({ fieldId: field.fieldId, rowId });
  const minWidth = leading ? getListLeadingFieldMinWidth(field.fieldType) : undefined;
  const interactive = field.fieldType === FieldType.Checkbox;

  return (
    <div
      className={cn(
        'list-property-cell flex h-5 min-w-0 items-center overflow-hidden text-xs leading-[18px] text-text-primary',
        interactive ? 'pointer-events-auto' : 'pointer-events-none',
        // Desktop pads every trailing cell 12px on the left, the first one included.
        !leading && 'shrink-0 pl-3'
      )}
      data-field-id={field.fieldId}
      data-testid={`list-field-${field.fieldId}-${rowId}`}
      style={{ minWidth }}
    >
      <ListCell cell={cell || undefined} field={field} rowId={rowId} style={listCellStyle} />
    </div>
  );
}

function ListPrimaryField({ field, rowId }: { field: Column; rowId: string }) {
  const { t } = useTranslation();
  const cell = useCellSelector({ fieldId: field.fieldId, rowId });
  const meta = useRowMetaSelector(rowId);
  const commentCount = useRowCommentCount(rowId);
  const isRowLoaded = useIsRowLoaded(rowId);
  const indicator = resolveListPrimaryIndicator(meta);

  return (
    <div
      className='list-primary-field flex h-5 min-w-0 max-w-full shrink items-center overflow-hidden'
      data-primary-indicator={indicator}
      data-testid={`list-primary-cell-${rowId}`}
    >
      {indicator === 'icon' ? (
        <span
          aria-hidden='true'
          className={cn(
            'mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center text-base leading-4',
            meta?.icon && isFlagEmoji(meta.icon) && 'icon'
          )}
        >
          {meta?.icon}
        </span>
      ) : indicator === 'document' ? (
        <DocumentIcon aria-hidden='true' className='mr-1 h-5 w-5 shrink-0 text-icon-secondary' />
      ) : null}
      <div className='flex min-w-0 max-w-full shrink items-center overflow-hidden'>
        {isRowLoaded ? (
          <Cell
            cell={cell || undefined}
            fieldId={field.fieldId}
            placeholder={indicator === 'none' ? t('grid.row.titlePlaceholder') : ''}
            readOnly
            rowId={rowId}
            style={listPrimaryCellStyle}
            wrap={false}
          />
        ) : (
          <span
            aria-label={t('grid.row.loading', 'Loading row')}
            className='h-3.5 w-3.5 animate-spin rounded-full border border-border-primary border-t-fill-theme-thick'
            role='status'
          />
        )}
      </div>
      {commentCount > 0 ? (
        <span
          aria-label={t('comments.count', { count: commentCount, defaultValue: `${commentCount} comments` })}
          className='ml-1 flex shrink-0 items-center gap-0.5 text-xs text-text-tertiary'
          data-testid={`list-row-comment-count-${rowId}`}
        >
          <CommentIcon aria-hidden='true' className='h-3.5 w-3.5' />
          {commentCount}
        </span>
      ) : null}
    </div>
  );
}

export interface ListRowProps {
  fields: Column[];
  groupFieldId?: string;
  groupId?: string;
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
  reorderable: boolean;
  rowId: string;
  rowOrders: Row[];
}

export const ListRow = memo(function ListRow({
  fields,
  groupFieldId,
  groupId,
  onDropRow,
  reorderable,
  rowId,
  rowOrders,
}: ListRowProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLDivElement | null>(null);
  const readOnly = useReadOnly();
  const hasSorts = useListHasSorts();
  const { bindRowSync, navigateToRow } = useDatabaseContext();
  const layout = useListRowLayout();
  const narrow = layout === 'narrow';
  const fieldGroups = useMemo(() => splitListFields(fields, groupFieldId), [fields, groupFieldId]);
  const hasTrailing = fieldGroups.trailing.length > 0;
  const dnd = useListRowDnd({
    dragHandleRef,
    enabled: reorderable && !readOnly,
    hasSorts,
    onDropRow,
    rowId,
    rowRef,
  });

  useEffect(() => {
    if (bindRowSync && rowId) bindRowSync(rowId);
  }, [bindRowSync, rowId]);

  const handleOpenRow = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (dnd.ignoreClickRef.current || isListRowInteractiveTarget(event.target)) return;
      navigateToRow?.(rowId);
    },
    [dnd.ignoreClickRef, navigateToRow, rowId]
  );

  return (
    <>
      <div
        className={cn('group/list-row relative flex w-full min-w-0 items-center', dnd.dragging && 'opacity-40')}
        data-layout={layout}
        data-row-id={rowId}
        data-testid={`list-row-${rowId}`}
        onClick={handleOpenRow}
        ref={rowRef}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: `auto ${narrow && hasTrailing ? LIST_ROW_NARROW_HEIGHT : LIST_ROW_HEIGHT}px`,
          minHeight: LIST_ROW_HEIGHT,
        }}
      >
        <button
          aria-label={t('grid.row.open', { defaultValue: 'Open row' })}
          className='pointer-events-none absolute inset-y-0 left-10 right-0 z-10 rounded-300 bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
          data-testid={`list-row-open-${rowId}`}
          onClick={(event) => {
            event.stopPropagation();
            navigateToRow?.(rowId);
          }}
          type='button'
        />
        {readOnly ? (
          <div aria-hidden className='shrink-0' style={{ width: LIST_ROW_ACTIONS_WIDTH }} />
        ) : (
          <ListRowActions
            dragHandleRef={(element) => {
              dragHandleRef.current = element;
            }}
            groupFieldId={groupFieldId}
            groupId={groupId}
            reorderable={reorderable}
            rowId={rowId}
            rowOrders={rowOrders}
          />
        )}

        {/*
          Desktop content box: 8px padding, 8px radius, height from the 20px
          title row (36px wide, 62px narrow with properties). The hover fill
          follows the whole row, gutter included, like desktop's MouseRegion.
        */}
        <div
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer overflow-hidden rounded-300 p-2',
            'group-hover/list-row:bg-fill-content-hover group-focus-within/list-row:bg-fill-content-hover',
            narrow ? 'flex-col items-start' : 'items-center'
          )}
          data-testid={`list-row-content-${rowId}`}
        >
          {/* Wide: intrinsic width (desktop's non-flex title row); narrow: a full line. */}
          <div
            className={cn('flex h-5 min-w-0 items-center', narrow ? 'w-full' : 'flex-initial')}
            data-testid={`list-row-title-${rowId}`}
          >
            {fieldGroups.leading.length > 0 ? (
              <div className='mr-3 flex h-5 shrink-0 items-center gap-1.5 overflow-hidden'>
                {fieldGroups.leading.map((field) => (
                  <ListPropertyCell field={field} key={field.fieldId} leading rowId={rowId} />
                ))}
              </div>
            ) : null}

            {fieldGroups.primary ? <ListPrimaryField field={fieldGroups.primary} rowId={rowId} /> : null}

            <ListRowPeekButton rowId={rowId} />
          </div>

          {hasTrailing ? (
            /*
              Desktop's horizontal SingleChildScrollView. `flex-row-reverse`
              with a single child is `reverse: true`: flush right when the
              cells fit, and the initial scroll position shows the right end
              when they overflow. The scrollbar stays hidden on every engine,
              while the container keeps its pointer events for wheel scrolling;
              clicks on it bubble to the row and still open it.
            */
            <div
              className={cn(
                'appflowy-hidden-scroller flex min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]',
                narrow ? 'mt-1.5 max-w-full' : 'ml-3 flex-1 flex-row-reverse'
              )}
              data-testid={`list-row-trailing-${rowId}`}
            >
              <div className='flex h-5 shrink-0 items-center'>
                {fieldGroups.trailing.map((field) => (
                  <ListPropertyCell field={field} key={field.fieldId} rowId={rowId} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {dnd.closestEdge ? <DropRowIndicator edge={dnd.closestEdge} /> : null}
      </div>
      {dnd.clearSortsDialog}
    </>
  );
});

export default ListRow;
