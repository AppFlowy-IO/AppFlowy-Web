import { useTranslation } from 'react-i18next';

import { useDashboardShowWidgetTitles, useReadOnly, useUpdateDashboardSetting } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import Layout from '@/components/database/components/settings/Layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

import type { ReactNode } from 'react';

/**
 * Settings menu of a Dashboard view. It only relies on the database context
 * (not on DashboardContext) so it also works when rendered outside the
 * dashboard provider, e.g. from a linked dashboard block toolbar.
 */
function DashboardSettings({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const showWidgetTitles = useDashboardShowWidgetTitles();
  const updateSetting = useUpdateDashboardSetting();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className='h-7 w-7'>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='!min-w-[200px]'
        data-testid='dashboard-settings-menu'
        onCloseAutoFocus={(event) => event.preventDefault()}
        side='bottom'
      >
        <DropdownMenuLabel>{t('dashboard.settings.name', { defaultValue: 'Dashboard settings' })}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <Layout currentLayout={DatabaseViewLayout.Dashboard} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className='w-full'
            data-testid='dashboard-settings-show-widget-titles'
            data-checked={showWidgetTitles ? 'true' : 'false'}
            disabled={readOnly}
            onSelect={(event) => {
              event.preventDefault();
              updateSetting({ showWidgetTitles: !showWidgetTitles });
            }}
          >
            <ShowIcon aria-hidden='true' />
            <span>{t('dashboard.settings.showWidgetTitles', { defaultValue: 'Show widget titles' })}</span>
            <Switch
              aria-hidden='true'
              checked={showWidgetTitles}
              className='pointer-events-none ml-auto'
              disabled={readOnly}
              tabIndex={-1}
            />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DashboardSettings;
