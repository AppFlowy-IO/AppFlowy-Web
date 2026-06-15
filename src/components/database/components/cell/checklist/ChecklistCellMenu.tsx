import { useMemo, useState } from 'react';

import {
  ChecklistCellData,
} from '@/application/database-yjs';
import { ChecklistCell as ChecklistCellType } from '@/application/database-yjs/cell.type';
import LinearProgressWithLabel from '@/components/_shared/progress/LinearProgressWithLabel';
import AddNewTask from '@/components/database/components/cell/checklist/AddNewTask';
import TaskList from '@/components/database/components/cell/checklist/TaskList';
import { useNavigationKey } from '@/components/database/components/cell/checklist/useNavigationKey';
import { useTaskActions } from '@/components/database/components/cell/checklist/useTaskActions';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

function ChecklistCellMenu ({ cell, data, rowId, fieldId, open, onOpenChange }: {
  open?: boolean;
  cell?: ChecklistCellType;
  onOpenChange?: (open: boolean) => void;
  data: ChecklistCellData | null;
  rowId: string;
  fieldId: string
}) {
  const tasks = useMemo(() => data?.options || [], [data]);
  const selectedTasks = useMemo(() => data?.selectedOptionIds || [], [data]);
  const percentage = data?.percentage;
  const count = tasks?.length || 0;
  const selectedCount = selectedTasks?.length || 0;

  const {
    createTaskValue,
    setCreateTaskValue,
    onToggleSelectedTask,
    onCreateTask,
    onChangeTask,
    onReorderTasks,
    onRemoveTask,
  } = useTaskActions({
    cell,
    rowId,
    fieldId,
  });

  const [element, setElement] = useState<HTMLElement | null>(null);

  useNavigationKey({
    onToggleSelectedTask,
    onCreateTask,
    element,
  });

  return (
    <Popover
      modal
      open={open}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger
        className={'absolute left-0 top-0 w-full h-full z-[-1]'}
      />
      <PopoverContent
        className={'max-w-[320px] overflow-hidden'}
        side={'bottom'}
        align={'start'}
      >
        <div ref={setElement}>
          {count === 0 ? <AddNewTask
            value={createTaskValue}
            onChange={setCreateTaskValue}
            onCreate={onCreateTask}
          /> : <div className={'flex flex-col'}>
            <div className={'p-2 flex flex-col'}>
              <LinearProgressWithLabel
                value={percentage || 0}
                count={count}
                selectedCount={selectedCount}
              />
              <TaskList
                onChangeTask={onChangeTask}
                onToggleChecked={onToggleSelectedTask}
                tasks={tasks}
                selectedTasks={selectedTasks}
                onReorderTasks={onReorderTasks}
                onRemoveTask={onRemoveTask}
                scrollable
              />
            </div>
            <Separator />
            <AddNewTask
              value={createTaskValue}
              onChange={setCreateTaskValue}
              onCreate={onCreateTask}
            />
          </div>}
        </div>

      </PopoverContent>
    </Popover>
  );
}

export default ChecklistCellMenu;