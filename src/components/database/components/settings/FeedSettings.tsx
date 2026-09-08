import { usePrimaryFieldId } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { ReactNode } from 'react';

function FeedSettings({ children }: { children: ReactNode }) {
  const primaryFieldId = usePrimaryFieldId();

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
          <Properties excludeFieldId={primaryFieldId ?? undefined} />
          <Layout currentLayout={DatabaseViewLayout.Feed} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default FeedSettings;
