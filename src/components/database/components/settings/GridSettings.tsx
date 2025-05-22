import { DatabaseViewLayout } from '@/application/types';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent, DropdownMenuTrigger, DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import React from 'react';

function GridSettings ({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className={'h-7 w-7'}>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={e => e.preventDefault()}
        side={'bottom'}
        align={'end'}
        className={'!min-w-[120px]'}
      >
        <DropdownMenuGroup>
          <Properties />
          <Layout currentLayout={DatabaseViewLayout.Grid} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default GridSettings;