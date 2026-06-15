import React, { lazy } from 'react';

import { Role, UIVariant } from '@/application/types';
import { OutlineDrawer } from '@/components/_shared/outline';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import NewPage from '@/components/app/view-actions/NewPage';
import { Workspaces } from '@/components/app/workspaces';
import { NotificationBell } from '@/components/notifications';

import Outline from 'src/components/app/outline/Outline';
import { Search } from 'src/components/app/search';


const SideBarBottom = lazy(() => import('@/components/app/SideBarBottom'));

interface SideBarProps {
  drawerWidth: number;
  drawerOpened: boolean;
  toggleOpenDrawer: (status: boolean) => void;
  onResizeDrawerWidth: (width: number) => void;
}

function SideBar({ drawerWidth, drawerOpened, toggleOpenDrawer, onResizeDrawerWidth }: SideBarProps) {
  const [scrollTop, setScrollTop] = React.useState<number>(0);

  const handleOnScroll = React.useCallback((scrollTop: number) => {
    setScrollTop(scrollTop);
  }, []);

  const userWorkspaceInfo = useUserWorkspaceInfo();

  const role = userWorkspaceInfo?.selectedWorkspace.role;

  return (
    <OutlineDrawer
      onResizeWidth={onResizeDrawerWidth}
      width={drawerWidth}
      open={drawerOpened}
      variant={UIVariant.App}
      onClose={() => toggleOpenDrawer(false)}
      header={
        <div className="flex flex-1 items-center overflow-hidden">
          <Workspaces />
        </div>
      }
      rightActions={<NotificationBell />}
      onScroll={handleOnScroll}
    >
      <div className={'flex w-full flex-1 flex-col gap-1'}>
        <div
          className={'sticky top-12 z-[1] mx-1 flex-col items-center justify-around gap-2 bg-surface-container-layer-00'}
        >
          <Search />
          {role === Role.Guest ? null : (
            <div
              style={{
                borderColor: scrollTop > 10 ? 'var(--border-primary)' : undefined,
              }}
              className={'flex w-full border-b border-transparent pb-3'}
            >
              <NewPage />
            </div>
          )}
        </div>

        <Outline width={drawerWidth} />

        {role === Role.Guest ? null : <SideBarBottom />}
      </div>
    </OutlineDrawer>
  );
}

export default SideBar;
