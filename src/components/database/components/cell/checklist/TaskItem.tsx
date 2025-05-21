import { SelectOption } from '@/application/database-yjs';
import { Button } from '@/components/ui/button';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import React, { useState } from 'react';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { useTranslation } from 'react-i18next';
import DragTask from '@/components/database/components/cell/checklist/DragTask';

function TaskItem ({ task, isSelected, onToggleChecked, onChange, onRemove }: {
  task: SelectOption;
  isSelected: boolean;
  onChange: (task: SelectOption) => void;
  onToggleChecked: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}) {
  const [value, setValue] = useState<string>(task.name);
  const { t } = useTranslation();
  const handleSubmit = (value: string) => {
    if (value === task.name) {
      return;
    }

    const newTask = {
      ...task,
      name: value,
    };

    onChange(newTask);
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    handleSubmit(event.target.value);
  };

  const [isHovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full h-fit gap-0')}
    >
      <DragTask id={task.id}>
        <span
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();

            onToggleChecked(task.id);
          }}
          className={'cursor-pointer'}
        >
      {isSelected ? <CheckboxCheckSvg /> : <CheckboxUncheckSvg />}
      </span>
        <TextareaAutosize
          placeholder={t('grid.checklist.taskHint')}
          data-task-id={`${task.id}`}
          className={'w-full whitespace-pre-wrap break-words'}
          variant={'ghost'}
          value={value}
          onChange={handleChange}
        />
        <Button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(task.id);
          }}
          variant={'ghost'}
          size={'icon-sm'}
          style={{
            visibility: isHovered ? 'visible' : 'hidden',
          }}
          className={'hover:text-text-error ml-auto'}
        >
          <DeleteIcon />
        </Button>


      </DragTask>

    </div>
  );
}

export default TaskItem;