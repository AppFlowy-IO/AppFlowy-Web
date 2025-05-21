import {
  addTask,
  ChecklistCellData, removeTask,
  reorderTasks,
  SelectOption,
  toggleSelectedTask,
  updateTask,
} from '@/application/database-yjs';
import { ChecklistCell as ChecklistCellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import LinearProgressWithLabel from '@/components/_shared/progress/LinearProgressWithLabel';
import AddNewTask from '@/components/database/components/cell/checklist/AddNewTask';
import TaskList from '@/components/database/components/cell/checklist/TaskList';
import { useNavigationKey } from '@/components/database/components/cell/checklist/useNavigationKey';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import React, { useCallback, useMemo, useState } from 'react';

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

  const [createTaskValue, setCreateTaskValue] = useState<string>('');

  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const onToggleSelectedTask = useCallback((taskId: string) => {
    const data = cell?.data || '';
    const newData = toggleSelectedTask(data, taskId);

    updateCell(newData);
  }, [cell?.data, updateCell]);
  const onCreateTask = useCallback(() => {
    const data = cell?.data || '';

    if (!createTaskValue) {
      return;
    }

    const newData = addTask(data, createTaskValue);

    setCreateTaskValue('');

    updateCell(newData);
  }, [cell?.data, createTaskValue, updateCell]);

  const onChangeTask = useCallback((task: SelectOption) => {
    const data = cell?.data || '';
    const newData = updateTask(data, task.id, task.name);

    updateCell(newData);
  }, [cell?.data, updateCell]);

  const onReorderTasks = useCallback((newTasks: SelectOption[]) => {
    const data = cell?.data || '';
    const newData = reorderTasks(data, newTasks);

    updateCell(newData);
  }, [cell?.data, updateCell]);

  const onRemoveTask = useCallback((taskId: string) => {
    const data = cell?.data || '';
    const newData = removeTask(data, taskId);

    updateCell(newData);
  }, [cell?.data, updateCell]);

  const [element, setElement] = useState<HTMLElement | null>(null);

  useNavigationKey({
    onToggleSelectedTask,
    onCreateTask,
    element,
  });

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger
        className={'absolute left-0 top-0 w-full h-full z-[-1]'}
      />
      <PopoverContent
        className={'max-w-[320px] overflow-hidden'}
      >
        <div ref={setElement}>
          {count === 0 ? <AddNewTask
            value={createTaskValue}
            onChange={setCreateTaskValue}
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
              />
            </div>
            <Separator />
            <AddNewTask
              value={createTaskValue}
              onChange={setCreateTaskValue}
            />
          </div>}
        </div>

      </PopoverContent>
    </Popover>
  );
}

export default ChecklistCellMenu;