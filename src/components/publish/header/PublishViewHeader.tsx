import { IconButton } from '@mui/material';
import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { HEADER_HEIGHT } from '@/application/constants';
import { usePublishContext } from '@/application/publish';
import { UIVariant } from '@/application/types';
import { ReactComponent as DoubleRightIcon } from '@/assets/icons/double_arrow_right.svg';
import { Breadcrumb } from '@/components/_shared/breadcrumb';
import { OutlinePopover } from '@/components/_shared/outline';
import Outline from '@/components/_shared/outline/Outline';
import { useOutlinePopover } from '@/components/_shared/outline/outline.hooks';
import BreadcrumbSkeleton from '@/components/_shared/skeleton/BreadcrumbSkeleton';
import {
  DATABASE_TAB_VIEW_ID_QUERY_PARAM,
  resolveSidebarSelectedViewId,
} from '@/components/app/hooks/resolveSidebarSelectedViewId';
import { getPlatform } from '@/utils/platform';

const RightMenu = lazy(() => import('@/components/publish/header/RightMenu'));

export function PublishViewHeader({
  drawerWidth,
  onOpenDrawer,
  openDrawer,
  onCloseDrawer,
}: {
  onOpenDrawer: () => void;
  drawerWidth: number;
  openDrawer: boolean;
  onCloseDrawer: () => void;
}) {
  const viewMeta = usePublishContext()?.viewMeta;
  const outline = usePublishContext()?.outline;
  const toView = usePublishContext()?.toView;
  const crumbs = usePublishContext()?.breadcrumbs;

  const { openPopover, debounceClosePopover, handleOpenPopover, debounceOpenPopover, handleClosePopover } =
    useOutlinePopover({
      onOpenDrawer,
      openDrawer,
      onCloseDrawer,
    });
  const isMobile = useMemo(() => {
    return getPlatform().isMobile;
  }, []);
  const [searchParams] = useSearchParams();
  const viewId = resolveSidebarSelectedViewId({
    routeViewId: viewMeta?.view_id,
    tabViewId: searchParams.get(DATABASE_TAB_VIEW_ID_QUERY_PARAM),
    outline,
  });
  const rendered = usePublishContext()?.rendered;

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
        {!openDrawer && !isMobile && (
          <OutlinePopover
            {...{
              onMouseEnter: handleOpenPopover,
              onMouseLeave: debounceClosePopover,
            }}
            open={openPopover}
            onClose={debounceClosePopover}
            drawerWidth={drawerWidth}
            content={
              <Outline
                variant={UIVariant.Publish}
                selectedViewId={viewId}
                navigateToView={toView}
                outline={outline}
                width={drawerWidth}
              />
            }
            variant={UIVariant.Publish}
          >
            <IconButton
              {...{
                onMouseEnter: debounceOpenPopover,
                onMouseLeave: debounceClosePopover,
                onClick: () => {
                  handleClosePopover();
                  onOpenDrawer();
                },
              }}
            >
              <DoubleRightIcon className={'text-text-secondary'} />
            </IconButton>
          </OutlinePopover>
        )}

        <div className={'h-full flex-1 overflow-hidden'}>
          {!viewMeta ? (
            <div className={'flex h-[48px] items-center'}>
              <BreadcrumbSkeleton />
            </div>
          ) : (
            <Breadcrumb toView={toView} crumbs={crumbs || []} variant={UIVariant.Publish} />
          )}
        </div>

        <div className={'flex items-center gap-2'}>
          {rendered && (
            <Suspense fallback={null}>
              <RightMenu />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}

export default PublishViewHeader;
