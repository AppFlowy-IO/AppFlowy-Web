import { useTranslation } from 'react-i18next';

import { useDashboardDisplaySettings, useReadOnly, useUpdateDashboardSetting } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as IconsIcon } from '@/assets/icons/emoji.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import Layout from '@/components/database/components/settings/Layout';
import { DASHBOARD_MENU_ITEM_CLASS, DASHBOARD_OVERLAY_CLASS } from '@/components/database/dashboard/dashboard-ui';
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
import { cn } from '@/lib/utils';

import type { ReactElement, ReactNode } from 'react';

/** A menu row that toggles a boolean setting; the switch only mirrors the state. */
function SettingsSwitchItem({
  checked,
  disabled,
  icon,
  label,
  onToggle,
  testId,
}: {
  checked: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <DropdownMenuItem
      className={cn(DASHBOARD_MENU_ITEM_CLASS, 'w-full')}
      role='menuitemcheckbox'
      aria-checked={checked}
      data-testid={testId}
      data-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
    >
      {icon}
      <span>{label}</span>
      <Switch
        aria-hidden='true'
        checked={checked}
        className='pointer-events-none ml-auto'
        disabled={disabled}
        tabIndex={-1}
      />
    </DropdownMenuItem>
  );
}

/**
 * Settings menu of a Dashboard view. It only relies on the database context
 * (not on DashboardContext) so it also works when rendered outside the
 * dashboard provider, e.g. from a linked dashboard block toolbar.
 */
function DashboardSettings({
  children,
  wrapTrigger,
}: {
  children: ReactNode;
  wrapTrigger?: (trigger: ReactElement) => ReactElement;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { showWidgetTitles, showIconsInHeading } = useDashboardDisplaySettings();
  const updateSetting = useUpdateDashboardSetting();
  const trigger = <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>;

  return (
    <DropdownMenu>
      {wrapTrigger ? wrapTrigger(trigger) : trigger}
      <DropdownMenuContent
        align='end'
        aria-label={t('dashboard.settings.name', { defaultValue: 'Dashboard settings' })}
        className={cn(DASHBOARD_OVERLAY_CLASS, '!min-w-[260px] p-2')}
        data-testid='dashboard-settings-menu'
        side='bottom'
      >
        <DropdownMenuLabel>{t('dashboard.settings.name', { defaultValue: 'Dashboard settings' })}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <Layout currentLayout={DatabaseViewLayout.Dashboard} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <SettingsSwitchItem
            checked={showWidgetTitles}
            disabled={readOnly}
            icon={<ShowIcon aria-hidden='true' />}
            label={t('dashboard.settings.showWidgetTitles', { defaultValue: 'Show widget titles' })}
            onToggle={() => updateSetting({ showWidgetTitles: !showWidgetTitles })}
            testId='dashboard-settings-show-widget-titles'
          />
          <SettingsSwitchItem
            checked={showIconsInHeading}
            disabled={readOnly}
            icon={<IconsIcon aria-hidden='true' />}
            label={t('dashboard.settings.showIconsInHeading', { defaultValue: 'Show icons in heading' })}
            onToggle={() => updateSetting({ showIconsInHeading: !showIconsInHeading })}
            testId='dashboard-settings-show-icons-in-heading'
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DashboardSettings;
