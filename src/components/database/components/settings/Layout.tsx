import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED } from '@/application/constants';
import { useDatabaseViewId } from '@/application/database-yjs';
import { useDatabaseContext } from '@/application/database-yjs/context';
import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';
import { DatabaseViewCreationHint } from '@/components/_shared/DatabaseViewCreationItem';
import { useDashboardCreationGate } from '@/components/app/hooks/useDashboardCreationGate';
import { useDatabaseViewCreation } from '@/components/app/hooks/useDatabaseViewCreation';
import { useServerHostingMode } from '@/components/app/hooks/useServerInfo';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { getErrorMessage } from '@/utils/errors';

interface LayoutOption {
  value: DatabaseViewLayout;
  label: string;
  disabledReason?: string;
}

function Layout({ currentLayout }: { currentLayout: DatabaseViewLayout }) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { workspaceId, getSubscriptions, isDashboardWidget } = useDatabaseContext();
  const isSelfHosted = useServerHostingMode() === 'self-hosted';
  const { getAction } = useDatabaseViewCreation({
    workspaceId,
    getSubscriptions,
    enabled: open && EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED,
  });
  const timelineAction = getAction(ViewLayout.Timeline);
  const timelineDisabledReason = timelineAction.type === 'create' ? undefined : timelineAction.reason;
  const viewId = useDatabaseViewId();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  const { available: canCreateDashboard, disabledReason: dashboardDisabledReason } = useDashboardCreationGate(
    getSubscriptions,
    { workspaceId, enabled: open }
  );
  // Dashboards never nest, so a widget's view cannot become one. Like
  // Timeline, an existing dashboard keeps its option while creation is off
  // (the feature flag, or a mobile context): it still reads as one.
  const isDashboard = currentLayout === DatabaseViewLayout.Dashboard;
  const showDashboard = (canCreateDashboard || isDashboard) && !isDashboardWidget;
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
      ...(isSelfHosted || currentLayout === DatabaseViewLayout.Chart
        ? [
            {
              value: DatabaseViewLayout.Chart,
              label: t('chart.menuName'),
            },
          ]
        : []),
      ...((isSelfHosted && EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED) || currentLayout === DatabaseViewLayout.Form
        ? [
            {
              value: DatabaseViewLayout.Form,
              label: t('form.menuName'),
            },
          ]
        : []),
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
    [t, currentLayout, showDashboard, isSelfHosted, timelineDisabledReason, dashboardDisabledReason]
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
                disabled={Boolean(option.disabledReason) || (option.value === DatabaseViewLayout.Timeline && option.value !== currentLayout && timelineAction.type !== 'create')}
                onSelect={() => {
                  if (option.value === currentLayout || option.disabledReason || (option.value === DatabaseViewLayout.Timeline && getAction(ViewLayout.Timeline).type !== 'create')) return;
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

            return (
              <DatabaseViewCreationHint
                key={option.value}
                enabled={option.value === DatabaseViewLayout.Timeline || option.value === DatabaseViewLayout.Dashboard}
                reason={option.disabledReason}
              >
                {item}
              </DatabaseViewCreationHint>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;
