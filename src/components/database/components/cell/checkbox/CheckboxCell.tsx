import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { CellProps, CheckboxCell as CheckboxCellType } from '@/application/database-yjs/cell.type';
import { cn } from '@/lib/utils';

enum CheckboxData {
  Yes = 'Yes',
  No = 'No',
}

export function CheckboxCell ({ cell, style, fieldId, rowId, readOnly }: CellProps<CheckboxCellType>) {
  const checked = cell?.data === CheckboxData.Yes;
  const onUpdateCell = useUpdateCellDispatch(rowId, fieldId);

  return (
    <div
      style={style}
      className={cn('relative h-full flex w-full text-lg text-fill-default', readOnly ? '' : 'cursor-pointer')}
      onClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        if (checked) {
          onUpdateCell(CheckboxData.No);
          return;
        }

        onUpdateCell(CheckboxData.Yes);
      }}
    >
      {checked ? <CheckboxCheckSvg className={'h-5 w-5'} /> : <CheckboxUncheckSvg className={'h-5 w-5'} />}
    </div>
  );
}
