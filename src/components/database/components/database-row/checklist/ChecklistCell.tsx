import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseChecklistFlexible } from '@/application/database-yjs';
import { CellProps, ChecklistCell as ChecklistCellType } from '@/application/database-yjs/cell.type';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { LinearProgressWithLabel } from '@/components/_shared/progress/LinearProgressWithLabel';
import TaskList from '@/components/database/components/cell/checklist/TaskList';
import { useNavigationKey } from '@/components/database/components/cell/checklist/useNavigationKey';
import { useTaskActions } from '@/components/database/components/cell/checklist/useTaskActions';
import NewTask from '@/components/database/components/database-row/checklist/NewTask';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function ChecklistCell({ cell, style, fieldId, rowId, readOnly }: CellProps<ChecklistCellType>) {
  const data = useMemo(() => {
    return parseChecklistFlexible(cell?.data ?? '');
  }, [cell?.data]);
  const tasks = useMemo(() => data?.options || [], [data]);
  const selectedTasks = useMemo(() => data?.selectedOptionIds || [], [data]);
  const percentage = data?.percentage;
  const count = tasks?.length || 0;
  const selectedCount = selectedTasks?.length || 0;
  const [hideComplete, setHideComplete] = useState<boolean>(false);
  const [hovering, setHovering] = useState<boolean>(false);
  const [showCreateTask, setShowCreateTask] = useState<boolean>(false);
  const { t } = useTranslation();
  const filteredTasks = useMemo(() => {
    return hideComplete ? tasks.filter((task) => !selectedTasks.includes(task.id)) : tasks;
  }, [hideComplete, tasks, selectedTasks]);

  const completedTasks = useMemo(() => {
    return hideComplete ? [] : selectedTasks;
  }, [hideComplete, selectedTasks]);

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

  useEffect(() => {
    if (!showCreateTask) {
      setCreateTaskValue('');
    }
  }, [showCreateTask, setCreateTaskValue]);

  const [element, setElement] = useState<HTMLElement | null>(null);

  useNavigationKey({
    onToggleSelectedTask,
    onCreateTask,
    element,
    setShowCreateTask,
    showCreateTask,
    readOnly,
  });

  return (
    <div
      ref={setElement}
      style={style}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn('w-full', !data && 'text-text-tertiary')}
    >
      <div className={'flex items-center gap-2'}>
        <LinearProgressWithLabel value={percentage || 0} count={count} selectedCount={selectedCount} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon-sm'}
              onClick={(e) => {
                if (readOnly) return;
                e.stopPropagation();
                setHideComplete((prev) => !prev);
              }}
              className={'[&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-icon-secondary'}
            >
              {hideComplete ? <ShowIcon /> : <HideIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {hideComplete ? t('grid.checklist.showComplete') : t('grid.checklist.hideComplete')}
          </TooltipContent>
        </Tooltip>
      </div>
      <TaskList
        onChangeTask={onChangeTask}
        onToggleChecked={onToggleSelectedTask}
        tasks={filteredTasks}
        selectedTasks={completedTasks}
        onReorderTasks={onReorderTasks}
        onRemoveTask={onRemoveTask}
      />
      {!readOnly && (
        <NewTask
          onCreateTask={onCreateTask}
          hovering={hovering}
          value={createTaskValue}
          onChange={setCreateTaskValue}
          showCreateInput={showCreateTask}
          setShowCreateInput={setShowCreateTask}
        />
      )}
    </div>
  );
}

export default ChecklistCell;
