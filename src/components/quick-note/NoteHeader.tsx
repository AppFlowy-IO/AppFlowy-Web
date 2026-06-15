import { IconButton } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { QuickNote } from '@/application/types';
import { ReactComponent as LeftIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as CollapseIcon } from '@/assets/icons/shrink.svg';
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
        <LeftIcon />
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
        {expand ? <CollapseIcon /> : <OpenIcon />}
      </IconButton>
      <IconButton onClick={onClose} size={'small'}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}

export default NoteHeader;
