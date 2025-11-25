import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import SwipeableViews from 'react-swipeable-views';

import MobileMore from '@/components/_shared/mobile-topbar/MobileMore';
import { AFScroller } from '@/components/_shared/scroller';
import { ViewTab, ViewTabs } from '@/components/_shared/tabs/ViewTabs';
import { AppContext, useAppOutline, useAppViewId } from '@/components/app/app.hooks';
import MobileFavorite from '@/components/app/favorite/MobileFavorite';
import MobileRecent from '@/components/app/recent/MobileRecent';
import MobileWorkspaces from '@/components/app/workspaces/MobileWorkspaces';


import MobileOutline from 'src/components/_shared/mobile-outline/MobileOutline';

enum ViewTabsKey {
  Space,
  Recent,
  Favorite,
}

function MobileFolder({ onClose }: { onClose: () => void }) {
  const outline = useAppOutline();
  const viewId = useAppViewId();
  const navigateToView = useContext(AppContext)?.toView;
  const [selectedTab, setSelectedTab] = React.useState<ViewTabsKey>(ViewTabsKey.Space);
  const { t } = useTranslation();

  return (
    <AFScroller overflowXHidden className={'flex w-full flex-1 flex-col gap-2'}>
      <div className={'sticky top-0 z-[10] w-full bg-background-primary p-2 pb-0'}>
        <div className={'mb-2 flex items-start justify-between gap-2'}>
          <div className={'flex-1'}>
            <MobileWorkspaces onClose={onClose} />
          </div>
          <MobileMore onClose={onClose} />
        </div>
        <ViewTabs
          value={selectedTab}
          sx={{
            '& .MuiTabs-indicator': {
              transform: 'scaleX(0.4)',
            },
          }}
          onChange={(_, value) => setSelectedTab(value)}
        >
          <ViewTab value={ViewTabsKey.Space} label={t('sideBar.Spaces')} />
          <ViewTab value={ViewTabsKey.Recent} label={t('sideBar.recent')} />
          <ViewTab value={ViewTabsKey.Favorite} label={t('sideBar.favorites')} />
        </ViewTabs>
      </div>

      <SwipeableViews
        index={selectedTab}
        onChangeIndex={setSelectedTab}
        className={'h-full'}
        containerStyle={{
          height: '100%',
        }}
      >
        <div className={'transform-gpu px-2 pb-[60px]'}>
          {outline && (
            <MobileOutline outline={outline} onClose={onClose} selectedViewId={viewId} navigateToView={navigateToView} />
          )}
        </div>
        <div className={'transform-gpu px-2 pb-[60px]'}>
          <MobileRecent onClose={onClose} />
        </div>
        <div className={'transform-gpu px-2 pb-[60px]'}>
          <MobileFavorite onClose={onClose} />
        </div>
      </SwipeableViews>
    </AFScroller>
  );
}

export default MobileFolder;
