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

/** The Feed settings rows (the title property is not listed); also rendered by a dashboard widget's settings host. */
export function FeedSettingsItems() {
  const primaryFieldId = usePrimaryFieldId();

  return (
    <>
      <Properties excludeFieldId={primaryFieldId ?? undefined} />
      <Layout currentLayout={DatabaseViewLayout.Feed} />
    </>
  );
}

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
          <FeedSettingsItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default FeedSettings;
