import React from 'react';

import { DatabaseViewLayout } from '@/application/types';
import CalendarLayoutSettings from '@/components/database/components/settings/CalendarLayoutSettings';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The Calendar settings rows; also rendered by a dashboard widget's settings host. */
export function CalendarSettingsItems() {
  return (
    <>
      <Properties />
      <Layout currentLayout={DatabaseViewLayout.Calendar} />
      <CalendarLayoutSettings />
    </>
  );
}

function CalendarSettings({ children }: { children: React.ReactNode }) {
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
          <CalendarSettingsItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default CalendarSettings;
