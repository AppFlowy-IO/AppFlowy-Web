import React from 'react';
import { useTranslation } from 'react-i18next';

import { useReadOnly } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';
import { useSubmenuPointerGuard } from '@/components/_shared/hooks/useSubmenuPointerGuard';
import { ChartSettingsPanel } from '@/components/database/chart/settings/ChartSettingsPanel';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The Chart rows of a dashboard widget's settings host ("View settings"):
 * Properties and Layout, then the chart settings panel itself (WP11 §1.1).
 */
export function ChartSettingsItems() {
  return (
    <>
      <Properties />
      <Layout currentLayout={DatabaseViewLayout.Chart} />
      <ChartSettingsPanel />
    </>
  );
}

/** "Chart settings ›" of the standalone gear menu: the panel in a 300px submenu. */
function ChartSettingsSubMenu() {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { contentRef, onTriggerPointerLeave } = useSubmenuPointerGuard();

  if (readOnly) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='chart-settings-trigger' onPointerLeave={onTriggerPointerLeave}>
        <ChartIcon className='h-4 w-4' />
        {t('chart.settings.chartSettings', { defaultValue: 'Chart settings' })}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          ref={contentRef}
          className='w-[300px] p-0'
          onFocusCapture={(event) => {
            // The panel contains form controls rather than Radix menu items.
            // Keyboard entry must reach one so its own Tab handling can run.
            if (event.target === event.currentTarget) {
              event.currentTarget.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
            }
          }}
        >
          <ChartSettingsPanel />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function ChartSettings({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className={'h-7 w-7'}>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        side={'bottom'}
        align={'end'}
        className={'!min-w-[120px]'}
      >
        <DropdownMenuGroup>
          <Properties />
          <Layout currentLayout={DatabaseViewLayout.Chart} />
          <ChartSettingsSubMenu />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ChartSettings;
