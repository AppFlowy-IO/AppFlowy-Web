import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { View, ViewLayout } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useSpaceActionPermissions } from '@/components/app/view-actions/useSpaceActionPermissions';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { MouseEvent } from 'react';

type SpaceSidebarAction = 'more' | 'add';

function SpaceSidebarActions({
  view,
  visible,
  onActionClick,
}: {
  view: View;
  visible: boolean;
  onActionClick: (event: MouseEvent<HTMLButtonElement>, action: SpaceSidebarAction) => void;
}) {
  const { t } = useTranslation();
  // Resolve permissions only after the row is first hovered/opened, then keep
  // the subscriptions alive so later permission notifications update trigger
  // visibility without issuing requests for every space on initial render.
  const [permissionsRequested, setPermissionsRequested] = useState(visible);

  useEffect(() => {
    if (visible) setPermissionsRequested(true);
  }, [visible]);

  const {
    canCreateViewActions,
    canManageViewActions,
    hasLoadedViewActionPermissions,
    isLoadingViewActionPermissions,
  } = useViewActionPermissions(view, permissionsRequested);
  const { canOpenManageSpace, hasLoadedSpaceActionPermissions, isLoadingSpaceActionPermissions } =
    useSpaceActionPermissions(view, permissionsRequested);
  const hasResolvedViewPermissions =
    hasLoadedViewActionPermissions && !isLoadingViewActionPermissions;
  const hasResolvedSpacePermissions =
    hasLoadedSpaceActionPermissions && !isLoadingSpaceActionPermissions;
  const canShowMore =
    (hasResolvedViewPermissions && canManageViewActions) ||
    (hasResolvedSpacePermissions && canOpenManageSpace);
  const canShowAdd =
    view.layout === ViewLayout.Document && hasResolvedViewPermissions && canCreateViewActions;

  if (!visible || (!canShowMore && !canShowAdd)) return null;

  return (
    <div onClick={(event) => event.stopPropagation()} className='flex items-center px-2'>
      {canShowMore && (
        <Tooltip disableHoverableContent delayDuration={500}>
          <TooltipTrigger asChild>
            <Button
              data-testid='inline-more-actions'
              variant='ghost'
              size='icon-sm'
              onClick={(event) => onActionClick(event, 'more')}
            >
              <MoreIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('space.manage')}</TooltipContent>
        </Tooltip>
      )}
      {canShowAdd && (
        <Tooltip disableHoverableContent delayDuration={500}>
          <TooltipTrigger asChild>
            <Button
              data-testid='inline-add-page'
              variant='ghost'
              size='icon-sm'
              onClick={(event) => onActionClick(event, 'add')}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sideBar.addAPage')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default SpaceSidebarActions;
