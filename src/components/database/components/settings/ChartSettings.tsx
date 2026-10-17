import { DatabaseViewLayout } from '@/application/types';
import ChartLayoutSettings from '@/components/database/components/settings/ChartLayoutSettings';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { ReactNode } from 'react';

/**
 * Desktop's chart settings popover (`SettingButton` in `ChartSettingBar`):
 * 240px wide, at most 550px tall and scrollable, with 8px of top padding and no
 * separators between Properties and Layout. The chart sections that follow
 * draw their own full-width divider and 6px bottom spacer.
 */
const CHART_SETTINGS_POPOVER_CLASS_NAME =
  'appflowy-scroller w-[240px] min-w-[240px] max-h-[min(550px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto px-2 pb-0 pt-2';

function ChartSettings({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className={'h-7 w-7'}>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        side={'bottom'}
        align={'end'}
        className={CHART_SETTINGS_POPOVER_CLASS_NAME}
        data-testid='chart-settings-panel'
      >
        <DropdownMenuGroup>
          <Properties />
          <Layout currentLayout={DatabaseViewLayout.Chart} />
        </DropdownMenuGroup>
        <ChartLayoutSettings />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ChartSettings;
