import { IconButton, Tooltip } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as PreviewIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as CopyLinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/save_as.svg';

function GalleryToolbar({
  onOpenPreview,
  onDownload,
  onCopy,
}: {
  onOpenPreview: () => void;
  onDownload: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  const buttons = useMemo(
    () => [
      { label: t('gallery.preview'), onClick: onOpenPreview, Icon: PreviewIcon },
      { label: t('gallery.copy'), onClick: onCopy, Icon: CopyLinkIcon },
      { label: t('gallery.download'), onClick: onDownload, Icon: DownloadIcon },
    ],
    [t, onOpenPreview, onDownload, onCopy]
  );

  return (
    <div className={'absolute right-0 top-0 z-10'}>
      <div className={'flex space-x-1 rounded-[8px] border border-border-primary bg-background-primary p-1 shadow '}>
        {buttons.map(({ label, onClick, Icon }, index) => (
          <Tooltip title={label} key={index}>
            <IconButton size={'small'} onClick={onClick} className={'p-1 hover:bg-transparent hover:text-text-action'}>
              <Icon />
            </IconButton>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export default GalleryToolbar;
