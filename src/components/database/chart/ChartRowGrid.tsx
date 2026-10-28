import { useVirtualizer } from '@tanstack/react-virtual';
import { CSSProperties, FC, forwardRef, KeyboardEvent, memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Column, FieldType, FieldVisibility, useCellSelector, useFieldsSelector } from '@/application/database-yjs';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { RowId } from '@/application/types';
import { Cell } from '@/components/database/components/cell';
import { PrimaryCell } from '@/components/database/components/cell/primary';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { cn } from '@/lib/utils';

/** Desktop's `kDesktopRowHeight`: a header cell, and a single-line row. */
const ROW_HEIGHT = 36;

/** Desktop's `kPopupRowMaxHeight`: wrapped text stops growing a row here. */
const ROW_MAX_HEIGHT = 160;

/** Fields the grid shows in the popup: desktop's `_getVisibleFields`. */
const VISIBILITIES = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty];

/**
 * Desktop's `resolveDesktopColumnWidths`: each column keeps its configured
 * width and the last one absorbs the rest, so the grid always fills the popup.
 * The header and the rows share this template, so columns cannot drift apart.
 */
function gridTemplate(columns: readonly Column[]) {
  return columns
    .map(({ width }, index) => (index === columns.length - 1 ? `minmax(${width}px, 1fr)` : `${width}px`))
    .join(' ');
}

function HeaderCell({ column, isLast }: { column: Column; isLast: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 border-b border-border-primary p-2 text-sm text-text-secondary',
        !isLast && 'border-r'
      )}
    >
      <FieldCustomIcon fieldId={column.fieldId} className='h-5 w-5 shrink-0 text-icon-secondary' />
      <span className='truncate'>{column.fieldName}</span>
    </div>
  );
}

function RowCell({ rowId, column, isLast }: { rowId: RowId; column: Column; isLast: boolean }) {
  const cell = useCellSelector({ rowId, fieldId: column.fieldId });
  const Component = (column.isPrimary ? PrimaryCell : Cell) as FC<CellProps<CellType>>;
  const isSelect = column.fieldType === FieldType.SingleSelect || column.fieldType === FieldType.MultiSelect;

  return (
    <div
      data-testid='chart-row-popup-cell'
      className={cn(
        // Fills its column, so the borders line up with the header row's.
        'flex min-w-0 flex-1 items-start overflow-hidden border-b border-border-primary px-2 text-sm',
        isSelect ? 'py-[7px]' : 'py-2',
        !isLast && 'border-r'
      )}
    >
      <Component cell={cell} rowId={rowId} fieldId={column.fieldId} readOnly wrap />
    </div>
  );
}

const RowItem = memo(
  forwardRef<
    HTMLDivElement,
    {
      rowId: RowId;
      index: number;
      columns: readonly Column[];
      template: string;
      style: CSSProperties;
      onOpen: (rowId: RowId) => void;
    }
  >(function RowItem({ rowId, index, columns, template, style, onOpen }, ref) {
    const handleKeyDown = useCallback(
      (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen(rowId);
      },
      [onOpen, rowId]
    );

    return (
      <div
        ref={ref}
        data-index={index}
        data-testid='chart-row-popup-row'
        data-row-id={rowId}
        role='button'
        tabIndex={0}
        onClick={() => onOpen(rowId)}
        onKeyDown={handleKeyDown}
        className='absolute left-0 top-0 grid w-full cursor-pointer overflow-hidden outline-none hover:bg-surface-layer-01-hover focus-visible:bg-surface-layer-01-hover'
        style={{ ...style, gridTemplateColumns: template, minHeight: ROW_HEIGHT, maxHeight: ROW_MAX_HEIGHT }}
      >
        {/* The cells are a read-only preview; the row itself takes the click. */}
        {columns.map((column, columnIndex) => (
          <div key={column.fieldId} className='pointer-events-none flex min-w-0'>
            <RowCell rowId={rowId} column={column} isLast={columnIndex === columns.length - 1} />
          </div>
        ))}
      </div>
    );
  })
);

/**
 * Desktop's `DesktopRowGrid`: a header row and one row per result, a column
 * per visible field. Header and rows scroll sideways together; only the rows
 * scroll vertically, and only the rows in view are mounted.
 */
export function ChartRowGrid({
  rowIds,
  onOpenRow,
  className,
}: {
  rowIds: readonly RowId[];
  onOpenRow: (rowId: RowId) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const visibleColumns = useFieldsSelector(VISIBILITIES);
  // Desktop leaves the row timestamps out of the popup.
  const columns = useMemo(
    () =>
      visibleColumns.filter(
        ({ fieldType }) => fieldType !== FieldType.CreatedTime && fieldType !== FieldType.LastEditedTime
      ),
    [visibleColumns]
  );
  const template = useMemo(() => gridTemplate(columns), [columns]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const virtualizer = useVirtualizer({
    count: rowIds.length,
    getScrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // The rows start below the sticky header row.
    scrollMargin: ROW_HEIGHT,
    getItemKey: (index) => rowIds[index] ?? index,
  });

  return (
    <div
      ref={scrollRef}
      data-testid='chart-row-popup-grid'
      className={cn('appflowy-custom-scroller min-h-0 overflow-auto', className)}
    >
      <div className='w-max min-w-full'>
        <div
          className='sticky top-0 z-[1] grid bg-surface-primary'
          style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
        >
          {columns.map((column, index) => (
            <HeaderCell key={column.fieldId} column={column} isLast={index === columns.length - 1} />
          ))}
        </div>
        {rowIds.length === 0 ? (
          <div className='flex items-center justify-center p-6 text-sm text-text-tertiary'>
            {t('chart.emptyState.title')}
          </div>
        ) : (
          <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <RowItem
                key={item.key}
                ref={virtualizer.measureElement}
                index={item.index}
                rowId={rowIds[item.index]}
                columns={columns}
                template={template}
                style={{ transform: `translateY(${item.start - ROW_HEIGHT}px)` }}
                onOpen={onOpenRow}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChartRowGrid;
