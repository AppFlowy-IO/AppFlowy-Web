import { DatabaseViewLayout } from '@/application/types';
import Layout from '@/components/database/components/settings/Layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { ReactNode } from 'react';

/**
 * Desktop parity: `database_settings_list.dart` exposes only the layout
 * switcher for Feed views, so the Feed settings menu has no properties or
 * layout-specific groups.
 */
function FeedSettings({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className='h-7 w-7'>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='!min-w-[120px]'
        data-testid='feed-settings-menu'
        onCloseAutoFocus={(event) => event.preventDefault()}
        side='bottom'
      >
        <DropdownMenuGroup>
          <Layout currentLayout={DatabaseViewLayout.Feed} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default FeedSettings;
