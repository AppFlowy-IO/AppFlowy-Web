import { useMemo } from 'react';

import { RollupCell as RollupCellType, CellProps } from '@/application/database-yjs/cell.type';
import { Tag } from '@/components/_shared/tag';
import { cn } from '@/lib/utils';

export function RollupCell({ cell, style, placeholder, rowId, fieldId, wrap }: CellProps<RollupCellType>) {
  const list = useMemo(() => {
    return (cell?.list ?? []).map((item) => item.trim()).filter(Boolean);
  }, [cell?.list]);
  const value = useMemo(() => {
    if (typeof cell?.data === 'string' || typeof cell?.data === 'number') {
      return String(cell.data);
    }

    return '';
  }, [cell]);
  const isList = list.length > 0;
  const isEmpty = !isList && !value;

  return (
    <div
      style={style}
      data-testid={`rollup-cell-${rowId}-${fieldId}`}
      className={cn(
        'rollup-cell flex w-full items-center gap-1',
        isEmpty && placeholder ? 'text-text-tertiary' : '',
        wrap
          ? 'flex-wrap overflow-x-hidden'
          : 'appflowy-hidden-scroller h-full w-full flex-nowrap overflow-x-auto overflow-y-hidden'
      )}
    >
      {isList
        ? list.map((item, index) => (
            <div key={`${item}-${index}`} className={'min-w-fit max-w-[140px]'}>
              <Tag label={item} />
            </div>
          ))
        : value || placeholder || ''}
    </div>
  );
}

export default RollupCell;
