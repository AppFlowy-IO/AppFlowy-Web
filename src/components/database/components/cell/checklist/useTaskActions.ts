import { useCallback, useState } from 'react';

import {
  addTask,
  removeTask,
  reorderTasks,
  SelectOption,
  toggleSelectedTask,
  updateTask,
} from '@/application/database-yjs';
import { ChecklistCell as ChecklistCellType } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';

export function useTaskActions ({ cell, rowId, fieldId }: {
  cell?: ChecklistCellType; rowId: string;
  fieldId: string;
}) {
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

  const onReorderTasks = useCallback(({
    oldData,
    newData,
    startIndex,
    finishIndex,
  }: {
    oldData: SelectOption[]
    newData: SelectOption[]
    startIndex: number
    finishIndex: number
  }) => {
    const data = cell?.data || '';
    const taskId = oldData[startIndex].id;

    if (!taskId) {
      throw new Error('No taskId provided');
    }

    const beforeId = newData[finishIndex - 1]?.id;

    updateCell(reorderTasks(data, { beforeId, taskId }));
  }, [cell?.data, updateCell]);

  const onRemoveTask = useCallback((taskId: string) => {
    const data = cell?.data || '';
    const newData = removeTask(data, taskId);

    updateCell(newData);
  }, [cell?.data, updateCell]);

  return {
    createTaskValue,
    setCreateTaskValue,
    onToggleSelectedTask,
    onCreateTask,
    onChangeTask,
    onReorderTasks,
    onRemoveTask,
  };
}