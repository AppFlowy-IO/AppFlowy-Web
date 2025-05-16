import { SelectOption } from '@/application/database-yjs';
import { generateOptionId, getColorByFirstChar } from '@/application/database-yjs/fields/select-option/utils';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';

function AddAnOption ({ onAdd }: {
  onAdd: (option: SelectOption) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>('');

  const handleAddOption = useCallback(() => {
    if (value) {
      onAdd({
        id: generateOptionId(),
        name: value,
        color: getColorByFirstChar(value),
      });
      setValue('');
    }
  }, [onAdd, value]);

  return (
    <DropdownMenuItem
      onPointerLeave={e => {
        if (editing) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onPointerMove={e => {
        if (editing) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onSelect={e => {
        e.preventDefault();
        setEditing(true);
      }}
      className={cn(editing ? 'hover:!bg-transparent !py-0' : '')}
    >
      {editing ? (
          <Input
            autoFocus
            className={'w-full'}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                handleAddOption();
              }
            }}
            onBlur={() => {
              setEditing(false);
              setValue('');
            }}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        ) :
        <>
          <AddIcon className={'h-5 w-5'} />
          {t('grid.field.addSelectOption')}
        </>
      }

    </DropdownMenuItem>
  );
}

export default AddAnOption;