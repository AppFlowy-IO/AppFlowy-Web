import Tooltip from '@mui/material/Tooltip';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as MoreIcon } from '@/assets/ai-transcript/summary-more.svg';
import { Popover } from '@/components/_shared/popover';
import { Button } from '@/components/ui/button';

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
      <Button
        type='button'
        variant='ghost'
        size='icon-lg'
        aria-label={t('document.aiMeeting.regenerate.moreActions')}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        className='rounded-lg p-1.5 text-icon-secondary'
      >
        <MoreIcon aria-hidden className="h-5 w-5 [&_[fill='#6F748C']]:fill-current [&_[stroke]]:stroke-current" />
      </Button>
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
