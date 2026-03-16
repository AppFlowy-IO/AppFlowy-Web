import { IconButton } from '@mui/material';
import { lazy, memo, Suspense, useMemo } from 'react';

import { UIVariant } from '@/application/types';
import { ReactComponent as DoubleArrowRight } from '@/assets/icons/double_arrow_right.svg';
import { Breadcrumb } from '@/components/_shared/breadcrumb';
import { useOutlinePopover } from '@/components/_shared/outline/outline.hooks';
import OutlinePopover from '@/components/_shared/outline/OutlinePopover';
import BreadcrumbSkeleton from '@/components/_shared/skeleton/BreadcrumbSkeleton';
import { useAppRendered, useToView, useBreadcrumb } from '@/components/app/app.hooks';
import Recent from '@/components/app/recent/Recent';

const RightMenu = lazy(() => import('@/components/app/header/RightMenu'));

interface AppHeaderProps {
  onOpenDrawer: () => void;
  drawerWidth: number;
  openDrawer: boolean;
  onCloseDrawer: () => void;
}

const HEADER_HEIGHT = 48;

export function AppHeader({ onOpenDrawer, openDrawer, onCloseDrawer }: AppHeaderProps) {
  const { openPopover, debounceClosePopover, handleOpenPopover, debounceOpenPopover, handleClosePopover } =
    useOutlinePopover({
      onOpenDrawer,
      openDrawer,
      onCloseDrawer,
    });

  const isTrash = window.location.pathname === '/app/trash';

  const crumbs = useBreadcrumb();

  const displayMenuButton = !openDrawer && window.innerWidth >= 480;

  const toView = useToView();
  const rendered = useAppRendered();

  const recent = useMemo(() => <Recent />, []);

  return (
    <div
      style={{
        backdropFilter: 'saturate(180%) blur(16px)',
        background: 'var(--bg-header)',
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
      }}
      className={'appflowy-top-bar sticky top-0 z-[100] flex transform-gpu px-5'}
    >
      <div className={'flex w-full items-center justify-between gap-4 overflow-hidden'}>
        {displayMenuButton && (
          <OutlinePopover
            {...{
              onMouseEnter: handleOpenPopover,
              onMouseLeave: debounceClosePopover,
            }}
            open={openPopover}
            onClose={debounceClosePopover}
            content={recent}
          >
            <IconButton
              size={'small'}
              {...{
                onMouseEnter: debounceOpenPopover,
                onMouseLeave: debounceClosePopover,
                onClick: () => {
                  handleClosePopover();
                  onOpenDrawer();
                },
              }}
            >
              <DoubleArrowRight className={'text-text-secondary'} />
            </IconButton>
          </OutlinePopover>
        )}
        <div className={'h-full flex-1 overflow-hidden'}>
          {isTrash || (crumbs && crumbs.length === 0) ? null : !crumbs ? (
            <div className={'flex h-[48px] items-center'}>
              <BreadcrumbSkeleton />
            </div>
          ) : (
            <Breadcrumb toView={toView} variant={UIVariant.App} crumbs={crumbs} />
          )}
        </div>
        {rendered && (
          <Suspense fallback={null}>
            <RightMenu />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default memo(AppHeader);
