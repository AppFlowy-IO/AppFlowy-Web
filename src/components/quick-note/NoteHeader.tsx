import React, { useMemo } from 'react';
import { ReactComponent as LeftIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as OpenIcon } from '@/assets/full_view.svg';
import { ReactComponent as CollapseIcon } from '@/assets/collapse_all_page.svg';
import { ReactComponent as CloseIcon } from '@/assets/close.svg';

import { IconButton } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { QuickNote } from '@/application/types';
import { getTitle } from '@/components/quick-note/utils';

function NoteHeader({
  note,
  onBack,
  onClose,
  expand,
  onToggleExpand,
}: {
  onBack: () => void;
  onClose: () => void;
  expand?: boolean;
  onToggleExpand?: () => void;
  note: QuickNote;
}) {
  const { t } = useTranslation();

  const title = useMemo(() => {
    return getTitle(note) || t('menuAppHeader.defaultNewPageName');
  }, [note, t]);

  return (
    <div className={'flex w-full items-center gap-4 overflow-hidden'}>
      <IconButton onClick={onBack} size={'small'}>
        <LeftIcon className={'h-5 w-5'} />
      </IconButton>
      <div className={'flex-1 truncate pl-[24px] text-center font-medium'}>{title}</div>
      <IconButton
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.currentTarget.blur();
          onToggleExpand?.();
        }}
        size={'small'}
      >
        {expand ? <CollapseIcon className={'rotate-45 transform'} /> : <OpenIcon />}
      </IconButton>
      <IconButton onClick={onClose} size={'small'}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}

export default NoteHeader;
