import { IconButton, Tooltip } from '@mui/material';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { Popover } from '@/components/_shared/popover';

import type { CopyMeta } from './ai-meeting.utils';

interface AIMeetingMoreMenuProps {
  activeCopyItem: CopyMeta;
  onCopy: () => Promise<boolean | void>;
}

export const AIMeetingMoreMenu = memo(({ activeCopyItem, onCopy }: AIMeetingMoreMenuProps) => {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(menuAnchor);
  const handleMenuClose = useCallback(() => setMenuAnchor(null), []);

  const handleCopyClick = useCallback(async () => {
    await onCopy();
    handleMenuClose();
  }, [handleMenuClose, onCopy]);

  return (
    <>
      <IconButton
        size="small"
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        className="rounded-md text-text-secondary hover:bg-fill-list-hover"
      >
        <MoreIcon className="h-5 w-5 text-current" />
      </IconButton>
      <Popover
        open={menuOpen}
        anchorEl={menuAnchor}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <div className="flex w-[240px] flex-col p-2 text-sm">
          {activeCopyItem.hasContent ? (
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-text-primary hover:bg-fill-list-hover"
              onClick={() => { void handleCopyClick(); }}
            >
              {t(activeCopyItem.labelKey)}
            </button>
          ) : (
            <Tooltip title={t('document.aiMeeting.copy.noContent')}>
              <span>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-text-tertiary"
                  disabled
                >
                  {t(activeCopyItem.labelKey)}
                </button>
              </span>
            </Tooltip>
          )}
        </div>
      </Popover>
    </>
  );
});

AIMeetingMoreMenu.displayName = 'AIMeetingMoreMenu';
