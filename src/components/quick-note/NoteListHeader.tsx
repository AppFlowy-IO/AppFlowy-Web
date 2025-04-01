import React, { useMemo } from 'react';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { ReactComponent as CollapseIcon } from '@/assets/icons/shrink.svg';

import { IconButton, InputBase, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { debounce } from 'lodash-es';

function NoteListHeader ({
  onSearch,
  onClose,
  expand,
  onToggleExpand,
}: {
  onSearch: (searchTerm: string) => void;
  onClose: () => void;
  expand?: boolean;
  onToggleExpand?: () => void;
}) {
  const { t } = useTranslation();
  const [activeSearch, setActiveSearch] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debounceSearch = useMemo(() => debounce((searchTerm: string) => {
    onSearch(searchTerm);
  }, 300), [onSearch]);

  return (
    <div
      className={'flex relative items-center w-full h-full gap-4'}
    >
      <Tooltip
        title={t('quickNote.search')}
        placement={'top'}
      >
        <IconButton
          className={`z-[2] ${activeSearch ? 'cursor-default hover:bg-transparent' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!activeSearch) {
              inputRef.current?.focus();
              setActiveSearch(true);
            }
          }}
          size={'small'}
        >
          <SearchIcon />
        </IconButton>
      </Tooltip>
      <div className={'flex-1'}>
        {activeSearch ?
          <InputBase
            className={'flex-1'}
            inputProps={{
              className: 'pb-0',
            }}
            autoFocus={true}
            onKeyDown={e => {
              if (activeSearch && createHotkey(HOT_KEY_NAME.ESCAPE)(e.nativeEvent)) {
                e.stopPropagation();
                setActiveSearch(false);
              }
            }}
            inputRef={inputRef}
            size={'small'}
            placeholder={t('quickNote.search')}
            onInput={(e) => {
              debounceSearch((e.target as HTMLInputElement).value);
            }}
          /> :
          <div className={'flex-1 ml-8 text-center font-medium text-base'}>{t('quickNote.quickNotes')}</div>
        }
      </div>

      <IconButton
        onMouseDown={e => e.preventDefault()}
        onClick={e => {
          e.currentTarget.blur();
          onToggleExpand?.();
        }}
        size={'small'}
      >
        {expand ? <CollapseIcon /> : <ExpandIcon />}
      </IconButton>

      <IconButton
        className={''}
        onClick={() => {
          if (activeSearch) {
            setActiveSearch(false);
            debounceSearch('');
          } else {
            onClose();
          }
        }}
        size={'small'}
      >
        <CloseIcon />
      </IconButton>
    </div>
  );
}

export default NoteListHeader;