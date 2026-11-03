import { DatabaseViewLayout } from '@/application/types';
import Layout from '@/components/database/components/settings/Layout';
import ListSettingGroup from '@/components/database/components/settings/ListSettingGroup';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { ReactNode } from 'react';

/** The List settings rows; also rendered by a dashboard widget's settings host. */
export function ListSettingsItems() {
  return (
    <>
      <Properties />
      <Layout currentLayout={DatabaseViewLayout.List} />
      <ListSettingGroup />
    </>
  );
}

function ListSettings({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className='h-7 w-7'>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='!min-w-[120px]'
        onCloseAutoFocus={(event) => event.preventDefault()}
        side='bottom'
      >
        <DropdownMenuGroup>
          <ListSettingsItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ListSettings;
