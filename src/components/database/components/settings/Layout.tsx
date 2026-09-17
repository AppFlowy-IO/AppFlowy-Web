import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_VIEW_ENABLED, TIMELINE_VIEW_ENABLED } from '@/application/constants';
import { useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { useUpdateDatabaseLayout } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as LayoutIcon } from '@/assets/icons/layout.svg';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

function Layout({ currentLayout }: { currentLayout: DatabaseViewLayout }) {
  const { t } = useTranslation();

  const viewId = useDatabaseViewId();
  const { isDashboardWidget } = useDatabaseContext();
  const updateLayout = useUpdateDatabaseLayout(viewId);
  // Dashboards never nest, so a widget's view cannot become one.
  const showDashboard = DASHBOARD_VIEW_ENABLED && !isDashboardWidget;
  const options = useMemo(
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
      ...(TIMELINE_VIEW_ENABLED
        ? [
            {
              value: DatabaseViewLayout.Timeline,
              label: t('timeline.menuName', { defaultValue: 'Timeline' }),
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
            },
          ]
        : []),
    ],
    [t, showDashboard]
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger aria-label={t('grid.settings.layout')} data-testid='database-layout-settings-trigger'>
        <LayoutIcon aria-hidden='true' />
        <span>{t('grid.settings.layout')}</span>
        <span className='ml-auto text-xs text-text-tertiary'>
          {options.find((option) => option.value === currentLayout)?.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[240px] overflow-y-auto'}>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              className={'w-full'}
              data-testid={`database-layout-option-${option.value}`}
              onSelect={() => {
                updateLayout(option.value);
              }}
            >
              <div className={'flex items-center gap-2'}>{option.label}</div>
              {currentLayout === option.value && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Layout;
