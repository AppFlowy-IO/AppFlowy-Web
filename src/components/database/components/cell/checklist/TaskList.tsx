import { SelectOption } from '@/application/database-yjs';
import TaskItem from '@/components/database/components/cell/checklist/TaskItem';
import {
  TaskDragContext,
  useTaskDragContextValue,
} from '@/components/database/components/cell/checklist/useTaskDragContext';
import React, { useState } from 'react';

function TaskList ({
  tasks,
  selectedTasks,
  onChangeTask,
  onToggleChecked,
  onRemoveTask,
  fieldId,
  onReorderTasks,
}: {
  fieldId: string;
  tasks: SelectOption[];
  selectedTasks: string[];
  onChangeTask: (task: SelectOption) => void;
  onToggleChecked: (taskId: string) => void;
  onReorderTasks: (newTasks: SelectOption[]) => void;
  onRemoveTask: (taskId: string) => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const contextValue = useTaskDragContextValue(fieldId, tasks, onReorderTasks, container);

  return (
    <div
      ref={setContainer}
      className={'flex flex-col'}
    >
      <TaskDragContext.Provider value={contextValue}>
        {tasks.map((task) => {
          const isSelected = selectedTasks.includes(task.id);

          return (
            <TaskItem
              key={task.id}
              onToggleChecked={onToggleChecked}
              onChange={onChangeTask}
              task={task}
              isSelected={isSelected}
              onRemove={onRemoveTask}
            />
          );
        })}
      </TaskDragContext.Provider>
    </div>
  );
}

export default TaskList;