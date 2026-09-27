import { lazy, Suspense, useCallback, useMemo } from 'react';

import { RollupCell as RollupCellType, RollupListItem, CellProps } from '@/application/database-yjs/cell.type';
import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { RollupShowAsType } from '@/application/database-yjs/fields/rollup/rollup.type';
import { getRollupVisualizationRatio } from '@/application/database-yjs/fields/rollup/visualization';
import { Tag } from '@/components/_shared/tag';
import { getRollupVisualizationColor } from '@/components/database/components/property/rollup/visualization';
import { cn } from '@/lib/utils';

import { RollupPersonList } from './RollupPersonList';
import { ShowAsVisualization } from './ShowAsVisualization';

const RollupCellMenu = lazy(() =>
  import('./RollupCellMenu').then(({ RollupCellMenu: Component }) => ({ default: Component }))
);

type RollupDisplayItem = Pick<RollupListItem, 'label'> & Partial<Pick<RollupListItem, 'rowId' | 'viewId'>>;

function normalizeListItems(listItems?: RollupListItem[], legacyList?: string[]) {
  const normalized: RollupDisplayItem[] = [];

  if (listItems) {
    for (const item of listItems) {
      const label = item.label.trim();

      if (label) normalized.push({ ...item, label });
    }

    return normalized;
  }

  for (const item of legacyList ?? []) {
    const label = item.trim();

    if (label) normalized.push({ label });
  }

  return normalized;
}

function RollupVisualization({ cell, value }: { cell: RollupCellType; value: string }) {
  const option = cell.visualization;

  if (!option || option.type === RollupShowAsType.Number || cell.rawNumeric === undefined) return null;

  const ratio = getRollupVisualizationRatio(
    cell.rawNumeric,
    cell.calculationType ?? CalculationType.Count,
    option.divisor
  );

  return (
    <ShowAsVisualization
      type={option.type}
      ratio={ratio}
      color={getRollupVisualizationColor(option.color)}
      value={value}
      showValue={Boolean(option.showNumber && value)}
    />
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
  const listItems = useMemo(() => normalizeListItems(cell?.listItems, cell?.list), [cell?.listItems, cell?.list]);
  const value = typeof cell?.data === 'string' || typeof cell?.data === 'number' ? String(cell.data) : '';
  const isList = listItems.length > 0;
  const isEmpty = !isList && !value;
  const canVisualize =
    !isCardCell &&
    cell?.showAs === RollupDisplayMode.Calculated &&
    ![CalculationType.DateEarliest, CalculationType.DateLatest, CalculationType.DateRange].includes(
      cell.calculationType ?? CalculationType.Count
    ) &&
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
      ) : cell &&
        [FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(cell.targetFieldType!) &&
        cell.showAs !== RollupDisplayMode.Calculated ? (
        <RollupPersonList
          value={listItems.length ? listItems.map((item) => item.label).join(', ') : value}
          type={cell.targetFieldType!}
        />
      ) : isList ? (
        listItems.map((item, index) => {
          const itemRowId = item.rowId;
          const itemViewId = item.viewId;
          const content = <Tag label={item.label} />;

          if (!itemRowId || !itemViewId || !navigateToRow) {
            return (
              <div
                key={`${item.label}-${index}`}
                className={'min-w-fit max-w-[140px] overflow-hidden rounded-[6px] bg-fill-secondary'}
              >
                {content}
              </div>
            );
          }

          return (
            <button
              key={`${itemViewId}-${itemRowId}-${index}`}
              type={'button'}
              data-testid={`rollup-list-item-${itemRowId}-${fieldId}-${index}`}
              className={'min-w-fit max-w-[140px] cursor-pointer overflow-hidden rounded-[6px] bg-fill-secondary'}
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
