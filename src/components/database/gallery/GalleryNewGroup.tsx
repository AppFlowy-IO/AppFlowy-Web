import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateDatabaseSelectGroupDispatch } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Input } from '@/components/ui/input';

/**
 * Figma "New group" ghost button (node 7448:47359) below the last group. Like
 * the desktop Board trailing control, it turns into a name field; Enter adds
 * the option and Escape or leaving the field cancels.
 */
export function GalleryNewGroup({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
  const createGroup = useCreateDatabaseSelectGroupDispatch(DatabaseViewLayout.Gallery);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const close = () => {
    setEditing(false);
    setName('');
  };

  if (editing) {
    return (
      <div className='w-[256px] py-0.5' data-testid='gallery-new-group-editor'>
        <Input
          aria-label={t('board.column.newGroup')}
          autoFocus
          data-testid='gallery-new-group-input'
          onBlur={close}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              const trimmed = name.trim();

              if (trimmed) createGroup(fieldId, trimmed);
              close();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          placeholder={t('gallery.newGroupPlaceholder')}
          value={name}
        />
      </div>
    );
  }

  return (
    <button
      className='flex h-8 items-center gap-1.5 rounded-200 px-3 text-sm font-medium text-text-secondary hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick'
      data-testid='gallery-new-group'
      onClick={() => setEditing(true)}
      type='button'
    >
      <PlusIcon aria-hidden='true' className='h-5 w-5 text-icon-secondary' />
      {t('board.column.newGroup')}
    </button>
  );
}

export default GalleryNewGroup;
