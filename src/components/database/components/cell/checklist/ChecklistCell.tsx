import { isNaN } from 'lodash-es';
import { useMemo } from 'react';

import { parseChecklistFlexible } from '@/application/database-yjs';
import { CellProps, ChecklistCell as ChecklistCellType } from '@/application/database-yjs/cell.type';
import LinearProgressWithLabel from '@/components/_shared/progress/LinearProgressWithLabel';
import ChecklistCellMenu from '@/components/database/components/cell/checklist/ChecklistCellMenu';
import { cn } from '@/lib/utils';

export function ChecklistCell({
  cell,
  style,
  placeholder,
  editing,
  setEditing,
  fieldId,
  rowId,
}: CellProps<ChecklistCellType>) {
  const data = useMemo(() => {
    return parseChecklistFlexible(cell?.data ?? '');
  }, [cell?.data]);

  const tasks = data?.options;
  const selectedTasks = data?.selectedOptionIds;

  return (
    <div style={style} className={cn('w-full', !data && 'text-text-tertiary')}>
      {!data || !tasks || !selectedTasks || isNaN(data?.percentage) ? (
        placeholder || ''
      ) : (
        <LinearProgressWithLabel value={data?.percentage} count={tasks.length} selectedCount={selectedTasks.length} />
      )}
      {editing && (
        <ChecklistCellMenu
          open={editing}
          onOpenChange={setEditing}
          data={data}
          fieldId={fieldId}
          rowId={rowId}
          cell={cell}
        />
      )}
    </div>
  );
}
