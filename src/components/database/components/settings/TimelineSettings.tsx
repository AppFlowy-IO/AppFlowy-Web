import React from 'react';

import { DatabaseViewLayout } from '@/application/types';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import TimelineLayoutSettings from '@/components/database/components/settings/TimelineLayoutSettings';
import TimelineSettingGroup from '@/components/database/components/settings/TimelineSettingGroup';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The Timeline settings rows; also rendered by a dashboard widget's settings host. */
export function TimelineSettingsItems() {
  return (
    <>
      <Properties />
      <Layout currentLayout={DatabaseViewLayout.Timeline} />
      <TimelineLayoutSettings />
      <TimelineSettingGroup />
    </>
  );
}

function TimelineSettings({ children }: { children: React.ReactNode }) {
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
          <TimelineSettingsItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default TimelineSettings;
