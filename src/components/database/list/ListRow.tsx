import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import {
  type CSSProperties,
  memo,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  useCellSelector,
  useDatabaseContext,
  useIsRowLoaded,
  useReadOnly,
  useRowCommentCount,
  useRowMetaSelector,
} from '@/application/database-yjs';
import type { Column, Row } from '@/application/database-yjs';
import { ReactComponent as CommentIcon } from '@/assets/icons/titlebar_comment.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/doc.svg';
import { Cell } from '@/components/database/components/cell/Cell';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import ClearSortingConfirm from '@/components/database/components/sorts/ClearSortingConfirm';
import { cn } from '@/lib/utils';

import { LIST_PRIMARY_MIN_WIDTH, LIST_PROPERTY_WIDTH, LIST_ROW_ACTIONS_WIDTH, LIST_ROW_HEIGHT } from './list.constants';
import { ListCell } from './ListCell';
import { ListRowActions } from './ListRowActions';
import { useListHasSorts } from './ListSortState';
import {
  getListLeadingFieldMinWidth,
  isListRowInteractiveTarget,
  resolveListPrimaryIndicator,
  splitListFields,
} from './list.utils';

const listCellStyle: CSSProperties = {
  alignItems: 'center',
  color: 'var(--text-secondary)',
  display: 'flex',
  fontSize: 12,
  lineHeight: '20px',
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
};

function ListPropertyCell({ field, leading, rowId }: { field: Column; leading?: boolean; rowId: string }) {
  const cell = useCellSelector({ fieldId: field.fieldId, rowId });
  const minWidth = leading ? getListLeadingFieldMinWidth(field.fieldType) : undefined;

  return (
    <div
      className={cn(
        'list-property-cell flex h-6 min-w-0 items-center overflow-hidden text-xs text-text-secondary',
        !leading && 'shrink-0 px-0.5'
      )}
      data-field-id={field.fieldId}
      data-testid={`list-field-${field.fieldId}-${rowId}`}
      style={{ minWidth, width: leading ? undefined : LIST_PROPERTY_WIDTH }}
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
      className='list-primary-field flex h-6 min-w-0 flex-1 items-center overflow-hidden'
      data-primary-indicator={indicator}
      data-testid={`list-primary-cell-${rowId}`}
      style={{ minWidth: LIST_PRIMARY_MIN_WIDTH }}
    >
      {indicator === 'icon' ? (
        <span aria-hidden='true' className='mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center text-sm'>
          {meta?.icon}
        </span>
      ) : indicator === 'document' ? (
        <DocumentIcon aria-hidden='true' className='mr-1.5 h-4 w-4 shrink-0 text-icon-tertiary' />
      ) : null}
      <div className='flex min-w-0 flex-1 items-center overflow-hidden'>
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

function useListRowDnd({
  dragHandleRef,
  enabled,
  onDropRow,
  rowId,
  rowRef,
  hasSorts,
}: {
  dragHandleRef: MutableRefObject<HTMLDivElement | null>;
  enabled: boolean;
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
  rowId: string;
  rowRef: MutableRefObject<HTMLDivElement | null>;
  hasSorts: boolean;
}) {
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clearSortsOpen, setClearSortsOpen] = useState(false);
  const pendingDropRef = useRef<(() => void) | null>(null);
  const ignoreClickRef = useRef(false);

  useEffect(() => {
    const element = rowRef.current;
    const dragHandle = dragHandleRef.current;

    if (!enabled || !element || !dragHandle || !onDropRow) return;

    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: () => ({ type: 'database-list-row', rowId }),
        onDragStart: () => {
          ignoreClickRef.current = true;
          setDragging(true);
        },
        onDrop: () => {
          setDragging(false);
          window.setTimeout(() => {
            ignoreClickRef.current = false;
          }, 0);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.type === 'database-list-row' && source.data.rowId !== rowId,
        getData: ({ input, element: targetElement }) =>
          attachClosestEdge(
            { type: 'database-list-row', rowId },
            { allowedEdges: ['top', 'bottom'], element: targetElement, input }
          ),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: ({ self, source }) => {
          const edge = extractClosestEdge(self.data);
          const sourceRowId = source.data.rowId;

          setClosestEdge(null);
          if (!edge || typeof sourceRowId !== 'string') return;

          const move = () => onDropRow(sourceRowId, rowId, edge);

          if (hasSorts) {
            pendingDropRef.current = move;
            setClearSortsOpen(true);
          } else {
            move();
          }
        },
      })
    );
  }, [dragHandleRef, enabled, hasSorts, onDropRow, rowId, rowRef]);

  return {
    clearSortsDialog:
      enabled && clearSortsOpen ? (
        <ClearSortingConfirm
          onClose={() => {
            pendingDropRef.current = null;
            setClearSortsOpen(false);
          }}
          onRemoved={() => {
            pendingDropRef.current?.();
            pendingDropRef.current = null;
          }}
          open={clearSortsOpen}
        />
      ) : null,
    closestEdge,
    dragging,
    ignoreClickRef,
  };
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
  const fieldGroups = useMemo(() => splitListFields(fields, groupFieldId), [fields, groupFieldId]);
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
        data-row-id={rowId}
        data-testid={`list-row-${rowId}`}
        onClick={handleOpenRow}
        ref={rowRef}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: `auto ${LIST_ROW_HEIGHT}px`,
          minHeight: LIST_ROW_HEIGHT,
        }}
      >
        <button
          aria-label={t('grid.row.open', { defaultValue: 'Open row' })}
          className='pointer-events-none absolute inset-y-0 left-10 right-0 z-10 rounded-[4px] bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
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

        <div className='flex h-9 min-w-0 flex-1 cursor-pointer items-center overflow-hidden rounded-[4px] px-1.5 py-1.5 hover:bg-fill-content-hover group-focus-within/list-row:bg-fill-content-hover'>
          <div className='flex h-6 min-w-0 flex-1 items-center overflow-hidden pl-0.5'>
            {fieldGroups.leading.length > 0 ? (
              <div className='mr-1.5 flex h-6 shrink-0 items-center gap-1.5 overflow-hidden'>
                {fieldGroups.leading.map((field) => (
                  <ListPropertyCell field={field} key={field.fieldId} leading rowId={rowId} />
                ))}
              </div>
            ) : null}

            {fieldGroups.primary ? <ListPrimaryField field={fieldGroups.primary} rowId={rowId} /> : null}

            {fieldGroups.trailing.length > 0 ? (
              <div className='ml-1.5 flex h-6 shrink-0 items-center justify-end overflow-hidden'>
                {fieldGroups.trailing.map((field) => (
                  <ListPropertyCell field={field} key={field.fieldId} rowId={rowId} />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {dnd.closestEdge ? <DropRowIndicator edge={dnd.closestEdge} /> : null}
      </div>
      {dnd.clearSortsDialog}
    </>
  );
});

export default ListRow;
