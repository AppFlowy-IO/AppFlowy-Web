import { observeElementRect, useVirtualizer, type Rect, type Virtualizer } from '@tanstack/react-virtual';
import { KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldVisibility,
  useCellSelector,
  useDatabaseContext,
  useFieldsSelector,
  useIsRowLoaded,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { drillColumns } from '@/application/database-yjs/drill-query';
import type { Column, Row } from '@/application/database-yjs/selector';
import { ReactComponent as DocumentIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as SidePeekIcon } from '@/assets/icons/side_peek.svg';
import { ensureRowsWithConcurrency } from '@/components/database/chart/hooks/rowLoadPool';
import { Cell } from '@/components/database/components/cell';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { DRILL, DRILL_CELL_STYLE, DRILL_OPEN_STYLE, DRILL_TABLE_STYLE } from './drillStyles';

const ALL_VISIBILITIES = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty, FieldVisibility.AlwaysHidden];
const OVERSCAN = 8;

/** The size to lay rows out in before the scroll box is measured (jsdom never measures it). */
const FALLBACK_RECT: Rect = { width: DRILL.width, height: DRILL.height - DRILL.tableTop };

function observeDrillRect(instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: Rect) => void) {
  return observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : FALLBACK_RECT));
}

export type DrillEmptyKind = 'noResults' | 'noData';

function useDrillColumns() {
  const columns = useFieldsSelector(ALL_VISIBILITIES);

  return useMemo(() => drillColumns(columns), [columns]);
}

function columnStyle(column: Column, last: boolean) {
  return last ? { minWidth: column.width, flex: `1 0 ${column.width}px` } : { width: column.width, flex: 'none' };
}

function HeaderRow({ columns }: { columns: Column[] }) {
  return (
    <div
      className='sticky top-0 z-[1] flex border-b border-border-primary bg-surface-primary'
      role='row'
      style={{ height: DRILL.rowHeight }}
    >
      {columns.map((column, index) => (
        <div
          className={cn(
            'flex items-center gap-1.5 overflow-hidden px-2 text-text-secondary',
            index < columns.length - 1 && 'border-r border-border-primary'
          )}
          data-testid='drill-column-header'
          key={column.fieldId}
          role='columnheader'
          style={{ ...columnStyle(column, index === columns.length - 1), ...DRILL_CELL_STYLE }}
        >
          <FieldCustomIcon className='h-4 w-4 shrink-0 text-icon-tertiary' fieldId={column.fieldId} />
          <span className='truncate'>{column.fieldName}</span>
        </div>
      ))}
    </div>
  );
}

function OpenPill({ rowId, alwaysVisible, onOpen }: { rowId: string; alwaysVisible: boolean; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      className={cn(
        'absolute right-1.5 top-1/2 -translate-y-1/2 items-center gap-1 rounded-100 border border-border-primary',
        'bg-surface-primary px-1.5 text-text-secondary hover:bg-fill-content-hover [&_svg]:h-3 [&_svg]:w-3',
        alwaysVisible
          ? 'flex'
          : 'hidden group-focus-within/drill-row:flex group-hover/drill-row:flex group-focus/drill-row:flex'
      )}
      data-testid={`drill-row-open-${rowId}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      style={DRILL_OPEN_STYLE}
      tabIndex={-1}
      type='button'
    >
      <SidePeekIcon aria-hidden='true' />
      {t('chart.drilldown.open', { defaultValue: 'OPEN' })}
    </button>
  );
}

function PrimaryCell({
  rowId,
  fieldId,
  alwaysShowOpen,
  onOpen,
}: {
  rowId: string;
  fieldId: string;
  alwaysShowOpen: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const cell = useCellSelector({ rowId, fieldId });
  const meta = useRowMetaSelector(rowId);
  const loaded = useIsRowLoaded(rowId);
  const data = cell?.data;
  const title = typeof data === 'string' ? data : '';

  return (
    <div className='relative flex h-full min-w-0 items-center gap-1.5 pr-16'>
      <span className='flex h-4 w-4 shrink-0 items-center justify-center text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'>
        {meta?.icon ? <span className='text-sm leading-none'>{meta.icon}</span> : <DocumentIcon aria-hidden='true' />}
      </span>
      <span className={cn('truncate', title ? 'text-text-primary' : 'text-text-tertiary')} data-testid='drill-row-title'>
        {title || (loaded ? t('grid.row.titlePlaceholder', { defaultValue: 'Untitled' }) : '')}
      </span>
      <OpenPill alwaysVisible={alwaysShowOpen} onOpen={onOpen} rowId={rowId} />
    </div>
  );
}

function DrillCell({ rowId, fieldId }: { rowId: string; fieldId: string }) {
  const cell = useCellSelector({ rowId, fieldId });

  return (
    <div className='pointer-events-none flex h-full min-w-0 items-center overflow-hidden'>
      <Cell cell={cell} fieldId={fieldId} readOnly rowId={rowId} wrap={false} />
    </div>
  );
}

const DrillRow = memo(function DrillRow({
  rowId,
  index,
  columns,
  start,
  active,
  alwaysShowOpen,
  onOpen,
  onKeyDown,
  onFocusRow,
}: {
  rowId: string;
  index: number;
  columns: Column[];
  start: number;
  active: boolean;
  alwaysShowOpen: boolean;
  onOpen: (rowId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onFocusRow: (index: number) => void;
}) {
  const open = useCallback(() => onOpen(rowId), [onOpen, rowId]);

  return (
    <div
      aria-rowindex={index + 2}
      className={cn(
        'group/drill-row absolute left-0 flex w-full cursor-pointer border-b border-border-primary text-text-primary',
        'hover:bg-dash-hover-fill focus:bg-dash-hover-fill focus:outline-none'
      )}
      data-index={index}
      data-parity-id='dash-drilldown-row'
      data-testid={`drill-row-${rowId}`}
      onClick={open}
      onFocus={() => onFocusRow(index)}
      onKeyDown={(event) => onKeyDown(event, index)}
      role='row'
      style={{ top: start, height: DRILL.rowHeight, ...DRILL_CELL_STYLE }}
      tabIndex={active ? 0 : -1}
    >
      {columns.map((column, columnIndex) => (
        <div
          className={cn(
            'flex h-full items-center overflow-hidden px-2',
            columnIndex < columns.length - 1 && 'border-r border-border-primary'
          )}
          key={column.fieldId}
          role='gridcell'
          style={columnStyle(column, columnIndex === columns.length - 1)}
        >
          {column.isPrimary ? (
            <PrimaryCell alwaysShowOpen={alwaysShowOpen} fieldId={column.fieldId} onOpen={open} rowId={rowId} />
          ) : (
            <DrillCell fieldId={column.fieldId} rowId={rowId} />
          )}
        </div>
      ))}
    </div>
  );
});

function SkeletonRows({ columns }: { columns: Column[] }) {
  // Static bars (no shimmer), so screenshots and tests are deterministic.
  const count = DRILL.skeletonRows;

  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <div
          className='flex border-b border-border-primary'
          data-testid='drill-skeleton-row'
          key={row}
          style={{ height: DRILL.rowHeight }}
        >
          {(columns.length > 0 ? columns : [null]).map((column, index) => (
            <div
              className='flex flex-1 items-center px-2'
              key={column?.fieldId ?? index}
              style={column ? columnStyle(column, index === columns.length - 1) : undefined}
            >
              <span className='block h-2 w-3/5 min-w-[40px] max-w-[160px] rounded-100 bg-fill-content-hover' />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function EmptyState({ kind, onClearSearch }: { kind: DrillEmptyKind; onClearSearch?: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className='flex min-h-[120px] flex-1 flex-col items-center justify-center gap-2 text-sm text-text-tertiary'
      data-testid='drill-empty'
    >
      {kind === 'noResults' ? (
        <>
          <span>{t('databaseSearch.noResults', { defaultValue: 'No results' })}</span>
          {onClearSearch ? (
            <Button data-testid='drill-clear-search' onClick={onClearSearch} size='sm' variant='ghost'>
              {t('databaseSearch.clearSearch', { defaultValue: 'Clear search' })}
            </Button>
          ) : null}
        </>
      ) : (
        <span>{t('chart.state.noData', { defaultValue: 'No data' })}</span>
      )}
    </div>
  );
}

/**
 * The read-only drill table (WP13 §3.5): a sticky header, 36px rows with the
 * primary field first, the OPEN pill on hover or keyboard focus (always on a
 * phone), 6 static skeleton rows while loading, and the empty states.
 * Virtualized; row docs are ensured for the rendered window only.
 */
export function DrillTable({
  rows,
  emptyKind,
  onClearSearch,
  onOpenRow,
  alwaysShowOpen,
  variant,
}: {
  /** `undefined` while the rows load. */
  rows: Row[] | undefined;
  emptyKind: DrillEmptyKind;
  onClearSearch?: () => void;
  onOpenRow: (rowId: string) => void;
  alwaysShowOpen: boolean;
  variant: 'dialog' | 'sheet';
}) {
  const columns = useDrillColumns();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { rowMap, ensureRow } = useDatabaseContext();
  const count = rows?.length ?? 0;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DRILL.rowHeight,
    overscan: OVERSCAN,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeDrillRect,
  });
  const items = virtualizer.getVirtualItems();
  const [activeIndex, setActiveIndex] = useState(0);
  const focusIndexRef = useRef<number | null>(null);
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  // Load the row docs of the rendered window only.
  const windowIds = useMemo(
    () => (rows ? items.map((item) => rows[item.index]?.id).filter((id): id is string => Boolean(id)) : []),
    [items, rows]
  );
  const windowKey = windowIds.join('\n');

  useEffect(() => {
    if (!ensureRow || !windowKey) return;
    const missing = windowKey.split('\n').filter((rowId) => !rowMap?.[rowId]);

    if (missing.length === 0) return;
    let cancelled = false;

    void ensureRowsWithConcurrency(missing, ensureRow, { isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
    // `rowMap` changes as docs arrive; the window decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureRow, windowKey]);

  useEffect(() => {
    if (activeIndex >= count && count > 0) setActiveIndex(count - 1);
  }, [activeIndex, count]);

  // Keyboard focus follows the active row once it is rendered.
  useEffect(() => {
    const index = focusIndexRef.current;

    if (index === null) return;
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);

    if (element) {
      focusIndexRef.current = null;
      element.focus();
    }
  });

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number) => {
      if (!rows) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const rowId = rows[index]?.id;

        if (rowId) onOpenRow(rowId);
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const next = Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1);

      if (next === index) return;
      setActiveIndex(next);
      focusIndexRef.current = next;
      virtualizer.scrollToIndex(next);
    },
    [onOpenRow, rows, virtualizer]
  );

  const loading = rows === undefined;
  const empty = !loading && count === 0;

  return (
    <div
      className='flex min-h-0 flex-1 flex-col'
      data-testid='drill-table'
      style={variant === 'dialog' ? DRILL_TABLE_STYLE : undefined}
    >
      <div className='min-h-0 flex-1 overflow-auto' ref={scrollRef}>
        <div
          aria-busy={loading || undefined}
          aria-colcount={columns.length}
          aria-rowcount={count + 1}
          className='flex min-w-full flex-col'
          role='grid'
          style={{ width: tableWidth || undefined }}
        >
          <HeaderRow columns={columns} />
          {loading ? <SkeletonRows columns={columns} /> : null}
          {empty ? <EmptyState kind={emptyKind} onClearSearch={onClearSearch} /> : null}
          {!loading && !empty ? (
            <div className='relative w-full' role='rowgroup' style={{ height: virtualizer.getTotalSize() }}>
              {items.map((item) => {
                const row = rows[item.index];

                if (!row) return null;
                return (
                  <DrillRow
                    active={item.index === activeIndex}
                    alwaysShowOpen={alwaysShowOpen}
                    columns={columns}
                    index={item.index}
                    key={row.id}
                    onFocusRow={setActiveIndex}
                    onKeyDown={onKeyDown}
                    onOpen={onOpenRow}
                    rowId={row.id}
                    start={item.start}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
