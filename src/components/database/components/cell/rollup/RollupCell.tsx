import { lazy, Suspense, useCallback } from 'react';

import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { RollupCell as RollupCellType, CellProps } from '@/application/database-yjs/cell.type';
import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { getRollupVisualizationRatio } from '@/application/database-yjs/fields/rollup/visualization';
import { Tag } from '@/components/_shared/tag';
import { getRollupVisualizationColor } from '@/components/database/components/property/rollup/visualization';
import { cn } from '@/lib/utils';

const RollupCellMenu = lazy(() =>
  import('./RollupCellMenu').then(({ RollupCellMenu: Component }) => ({ default: Component }))
);

function RollupVisualization({ cell, value }: { cell: RollupCellType; value: string }) {
  const option = cell.visualization;

  if (!option || option.type === RollupShowAsType.Number || cell.rawNumeric === undefined) return null;

  const ratio = getRollupVisualizationRatio(
    cell.rawNumeric,
    cell.calculationType ?? CalculationType.Count,
    option.divisor
  );
  const color = getRollupVisualizationColor(option.color);
  const showValue = option.showNumber && value;

  if (option.type === RollupShowAsType.Bar) {
    return (
      <div className={'flex w-full items-center gap-2'} data-testid={'rollup-bar-visualization'}>
        {showValue ? <span className={'shrink-0'}>{value}</span> : null}
        <div className={'h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-fill-secondary'}>
          <div className={'h-full rounded-full'} style={{ background: color, width: `${ratio * 100}%` }} />
        </div>
      </div>
    );
  }

  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={'flex items-center gap-2'} data-testid={'rollup-ring-visualization'}>
      {showValue ? <span>{value}</span> : null}
      <svg
        className={'h-4 w-4 -rotate-90'}
        viewBox={'0 0 16 16'}
        role={'img'}
        aria-label={`${Math.round(ratio * 100)}%`}
      >
        <circle cx={'8'} cy={'8'} r={radius} fill={'none'} stroke={'var(--fill-secondary)'} strokeWidth={'3'} />
        <circle
          cx={'8'}
          cy={'8'}
          r={radius}
          fill={'none'}
          stroke={color}
          strokeWidth={'3'}
          strokeLinecap={'round'}
          strokeDasharray={`${ratio * circumference} ${circumference}`}
        />
      </svg>
    </div>
  );
}

export function RollupCell({
  cell,
  style,
  placeholder,
  rowId,
  fieldId,
  wrap,
  editing,
  setEditing,
  readOnly,
  isCardCell,
}: CellProps<RollupCellType>) {
  const context = useDatabaseContextOptional();
  const databasePageId = context?.databasePageId;
  const navigateToRow = context?.navigateToRow;
  const listItems = (
    cell?.listItems ?? (cell?.list ?? []).map((label) => ({ label, rowId: undefined, viewId: undefined }))
  )
    .map((item) => ({ ...item, label: item.label.trim() }))
    .filter((item) => Boolean(item.label));
  const value = typeof cell?.data === 'string' || typeof cell?.data === 'number' ? String(cell.data) : '';
  const isList = listItems.length > 0;
  const isEmpty = !isList && !value;
  const canVisualize =
    !isCardCell &&
    cell?.showAs === RollupDisplayMode.Calculated &&
    cell.targetFieldType === FieldType.Number &&
    cell.visualization?.type !== RollupShowAsType.Number &&
    cell.rawNumeric !== undefined;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setEditing?.(open);
    },
    [setEditing]
  );

  return (
    <div
      style={style}
      data-testid={`rollup-cell-${rowId}-${fieldId}`}
      className={cn(
        'rollup-cell relative flex w-full items-center gap-1',
        isEmpty && placeholder ? 'text-text-tertiary' : '',
        wrap
          ? 'flex-wrap overflow-x-hidden'
          : 'appflowy-hidden-scroller h-full w-full flex-nowrap overflow-x-auto overflow-y-hidden'
      )}
    >
      {canVisualize && cell ? (
        <RollupVisualization cell={cell} value={value} />
      ) : isList ? (
        listItems.map((item, index) => {
          const itemRowId = item.rowId;
          const itemViewId = item.viewId;
          const content = <Tag label={item.label} />;

          if (!itemRowId || !itemViewId || !navigateToRow) {
            return (
              <div key={`${item.label}-${index}`} className={'min-w-fit max-w-[140px]'}>
                {content}
              </div>
            );
          }

          return (
            <button
              key={`${itemViewId}-${itemRowId}-${index}`}
              type={'button'}
              data-testid={`rollup-list-item-${itemRowId}-${fieldId}-${index}`}
              className={'min-w-fit max-w-[140px] cursor-pointer overflow-hidden underline hover:text-text-action'}
              onClick={(event) => {
                event.stopPropagation();
                navigateToRow(itemRowId, itemViewId !== databasePageId ? itemViewId : undefined);
              }}
            >
              {content}
            </button>
          );
        })
      ) : (
        value || placeholder || ''
      )}
      {editing && !readOnly ? (
        <Suspense fallback={null}>
          <RollupCellMenu fieldId={fieldId} open={editing} onOpenChange={handleOpenChange} />
        </Suspense>
      ) : null}
    </div>
  );
}

export default RollupCell;
