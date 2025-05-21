import { Button } from '@/components/ui/button';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

function AddNewTask ({ value, onChange }: {
  value: string,
  onChange: (value: string) => void,
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const { t } = useTranslation();

  return (
    <div className={'flex p-2 items-center w-full gap-1.5'}>
      <TextareaAutosize
        data-task-id="create"
        placeholder={t('grid.checklist.addNew')}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        variant={'ghost'}
        autoFocus
      />
      <Button disabled={!value}>{t('button.create')}</Button>
    </div>
  );
}

export default AddNewTask;