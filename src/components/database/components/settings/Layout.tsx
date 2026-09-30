import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED } from '@/application/constants';
import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';
import { useMobileContext } from '@/components/_shared/hooks/useMobileContext';
import { useTimelineCreationDisabledReason } from '@/components/app/hooks/useTimelineCreationDisabledReason';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getErrorMessage } from '@/utils/errors';

interface LayoutOption {
  value: DatabaseViewLayout;
  label: string;
  disabledReason?: string;
}

function Layout({ currentLayout }: { currentLayout: DatabaseViewLayout }) {
  const { t } = useTranslation();

  const viewId = useDatabaseViewId();
  const { isDashboardWidget, getSubscriptions, workspaceId } = useDatabaseContext();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const mobileContext = useMobileContext();
  const [open, setOpen] = useState(false);
  // Converting to Timeline or Dashboard creates that view type, so it follows
  // the same workspace Pro policy as the tab "+" menu.
  const timelineDisabledReason = useTimelineCreationDisabledReason(getSubscriptions, {
    workspaceId,
    enabled: EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED && open,
  });
  const dashboardDisabledReason = useTimelineCreationDisabledReason(getSubscriptions, {
    workspaceId,
    enabled: EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED && open,
    requiresProMessage: t('dashboard.creationRequiresPro', {
      defaultValue: 'Creating a Dashboard view requires a Pro workspace.',
    }),
  });
  // Dashboards never nest, so a widget's view cannot become one. Like
  // Timeline, an existing dashboard keeps its option while creation is off.
  // Dashboards are view-only in a mobile context, so nothing converts to one
  // there, but a dashboard still reads as one.
  const isDashboard = currentLayout === DatabaseViewLayout.Dashboard;
  const showDashboard =
    (EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED || isDashboard) && !isDashboardWidget && (!mobileContext || isDashboard);
  const options = useMemo<LayoutOption[]>(
    () => [
      {
        value: DatabaseViewLayout.Grid,
        label: t('grid.menuName'),
      },
      {
        value: DatabaseViewLayout.Board,
        label: t('board.menuName'),
      },
      {
        value: DatabaseViewLayout.Calendar,
        label: t('calendar.menuName'),
      },
      ...(EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED || currentLayout === DatabaseViewLayout.Timeline
        ? [
            {
              value: DatabaseViewLayout.Timeline,
              label: t('timeline.menuName', { defaultValue: 'Timeline' }),
              disabledReason: currentLayout === DatabaseViewLayout.Timeline ? undefined : timelineDisabledReason,
            },
          ]
        : []),
      {
        value: DatabaseViewLayout.Chart,
        label: t('chart.menuName'),
      },
      {
        value: DatabaseViewLayout.List,
        label: t('list.menuName'),
      },
      {
        value: DatabaseViewLayout.Gallery,
        label: t('gallery.menuName'),
      },
      {
        value: DatabaseViewLayout.Feed,
        label: t('feed.menuName'),
      },
      ...(showDashboard
        ? [
            {
              value: DatabaseViewLayout.Dashboard,
              label: t('dashboard.menuName', { defaultValue: 'Dashboard' }),
              disabledReason: currentLayout === DatabaseViewLayout.Dashboard ? undefined : dashboardDisabledReason,
            },
          ]
        : []),
    ],
    [t, currentLayout, showDashboard, timelineDisabledReason, dashboardDisabledReason]
  );

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger aria-label={t('grid.settings.layout')} data-testid='database-layout-settings-trigger'>
        <LayoutIcon aria-hidden='true' />
        <span>{t('grid.settings.layout')}</span>
        <span className='ml-auto text-xs text-text-tertiary'>
          {options.find((option) => option.value === currentLayout)?.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[240px] overflow-y-auto'}>
          {options.map((option) => {
            const item = (
              <DropdownMenuItem
                key={option.value}
                className={'w-full'}
                data-testid={`database-layout-option-${option.value}`}
                disabled={Boolean(option.disabledReason)}
                onSelect={() => {
                  if (option.value === currentLayout || option.disabledReason) return;
                  void (async () => {
                    try {
                      await updateLayout(option.value);
                    } catch (error) {
                      toast.error(getErrorMessage(error, 'Failed to change view layout'));
                    }
                  })();
                }}
              >
                <div className={'flex items-center gap-2'}>{option.label}</div>
                {currentLayout === option.value && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            );

            return option.disabledReason ? (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <div>{item}</div>
                </TooltipTrigger>
                <TooltipContent>{option.disabledReason}</TooltipContent>
              </Tooltip>
            ) : (
              item
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;
