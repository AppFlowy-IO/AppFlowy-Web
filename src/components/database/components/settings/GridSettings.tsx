import { DatabaseViewLayout } from '@/application/types';
import GridSettingGroup from '@/components/database/components/settings/GridSettingGroup';
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
 * The Grid settings rows: properties, layout and grouping (desktop's order).
 * Also rendered by a dashboard widget's settings host.
 */
export function GridSettingsItems() {
  return (
    <>
      <Properties />
      <Layout currentLayout={DatabaseViewLayout.Grid} />
      <GridSettingGroup />
    </>
  );
}

function GridSettings({ children }: { children: ReactNode }) {
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
          <GridSettingsItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default GridSettings;
