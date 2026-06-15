import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';

function AddNewTask({
  value,
  onChange,
  onCreate,
}: {
  value: string;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const { t } = useTranslation();

  return (
    <div className={'flex w-full items-center gap-1.5 p-2'}>
      <TextareaAutosize
        data-task-id='create'
        placeholder={t('grid.checklist.addNew')}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        variant={'ghost'}
        autoFocus
      />
      <Button
        onMouseDown={(e) => {
          e.preventDefault();
          onCreate();
        }}
        disabled={!value}
      >
        {t('button.create')}
      </Button>
    </div>
  );
}

export default AddNewTask;
