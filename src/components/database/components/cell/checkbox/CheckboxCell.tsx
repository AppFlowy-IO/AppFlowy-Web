import { useEffect } from 'react';

import { CellProps, CheckboxCell as CheckboxCellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { cn } from '@/lib/utils';

export function CheckboxCell({
  cell,
  style,
  fieldId,
  rowId,
  readOnly,
  editing,
  setEditing,
}: CellProps<CheckboxCellType>) {
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);
  const checked = getChecked(cell?.data);

  useEffect(() => {
    if (readOnly) return;
    if (editing) {
      if (checked) {
        onUpdateCell('No');
      } else {
        onUpdateCell('Yes');
      }

      setEditing?.(false);
    }
  }, [checked, editing, onUpdateCell, setEditing, readOnly]);
  return (
    <div
      style={style}
      data-testid={`checkbox-cell-${rowId}-${fieldId}`}
      data-checked={checked}
      className={cn('relative flex h-full w-full text-lg text-text-action', readOnly ? '' : 'cursor-pointer')}
    >
      {checked ? (
        <CheckboxCheckSvg className={'h-5 w-5'} data-testid="checkbox-checked-icon" />
      ) : (
        <CheckboxUncheckSvg className={'h-5 w-5 text-border-primary hover:text-border-primary-hover'} data-testid="checkbox-unchecked-icon" />
      )}
    </div>
  );
}
