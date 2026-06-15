import { IconButton } from '@mui/material';
import React, { useCallback, useMemo } from 'react';

import { HEADER_HEIGHT } from '@/application/constants';
import { UIVariant } from '@/application/types';
import { ReactComponent as MenuIcon } from '@/assets/icons/double_arrow_right.svg';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { Breadcrumb } from '@/components/_shared/breadcrumb';
import { withAppBreadcrumb } from '@/components/_shared/breadcrumb/withAppBreadcrumb';
import { withPublishBreadcrumb } from '@/components/_shared/breadcrumb/withPublishBreadcrumb';
import { MobileDrawer } from '@/components/_shared/mobile-drawer';
import MobileFolder from '@/components/_shared/mobile-topbar/MobileFolder';
import PublishMobileFolder from '@/components/_shared/mobile-topbar/PublishMobileFolder';
import MoreActionsContent from '@/components/_shared/more-actions/MoreActionsContent';
import { openOrDownload } from '@/utils/open_schema';
import { getPlatform } from '@/utils/platform';

const PublishBreadcrumb = withPublishBreadcrumb(Breadcrumb);
const AppBreadcrumb = withAppBreadcrumb(Breadcrumb);

function MobileTopBar({ variant }: { variant?: UIVariant }) {
  const [openFolder, setOpenFolder] = React.useState(false);
  const [openMore, setOpenMore] = React.useState(false);
  const isMobile = getPlatform().isMobile;
  const folderDrawerWidth = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const availableWidth = Math.max(0, window.innerWidth - 56);

    if (isMobile) return availableWidth;

    return Math.min(420, availableWidth);
  }, [isMobile]);

  const handleOpenFolder = useCallback(() => {
    setOpenFolder(true);
  }, []);

  const handleCloseFolder = useCallback(() => {
    setOpenFolder(false);
  }, []);

  const handleOpenMore = useCallback(() => {
    setOpenMore(true);
  }, []);
  const handleCloseMore = useCallback(() => {
    setOpenMore(false);
  }, []);

  return (
    <div
      style={{
        backdropFilter: 'saturate(180%) blur(16px)',
        background: 'var(--bg-header)',
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
      }}
      className={
        'appflowy-top-bar sticky top-0 z-[100] flex h-[48px] min-h-[48px] w-full transform-gpu items-center justify-between gap-2 px-4'
      }
    >
      <MobileDrawer
        swipeAreaWidth={folderDrawerWidth}
        onOpen={handleOpenFolder}
        onClose={handleCloseFolder}
        open={openFolder}
        anchor={'left'}
        showPuller={false}
        topOffset={HEADER_HEIGHT}
        triggerNode={
          <IconButton>
            <MenuIcon />
          </IconButton>
        }
      >
        {variant === UIVariant.App ? (
          <MobileFolder onClose={handleCloseFolder} />
        ) : (
          <PublishMobileFolder onClose={handleCloseFolder} />
        )}
      </MobileDrawer>

      {variant === UIVariant.Publish ? <PublishBreadcrumb /> : <AppBreadcrumb />}
      <div className={'flex items-center gap-4'}>
        <button onClick={() => openOrDownload()}>
          <Logo className={'h-5 w-5'} />
        </button>
        <MobileDrawer
          onOpen={handleOpenMore}
          onClose={handleCloseMore}
          open={openMore}
          anchor={'bottom'}
          triggerNode={
            <IconButton className={'opacity-70'}>
              <MoreIcon />
            </IconButton>
          }
        >
          <div className={'h-full w-full px-2 pt-10'}>
            <MoreActionsContent itemClicked={handleCloseMore} />
          </div>
        </MobileDrawer>
      </div>
    </div>
  );
}

export default MobileTopBar;
