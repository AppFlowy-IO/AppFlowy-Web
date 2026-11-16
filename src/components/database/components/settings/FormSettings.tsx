import type { ReactNode } from 'react';

import { DatabaseViewLayout } from '@/application/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import Layout from './Layout';

/** Flutter's Form settings expose Layout, without row properties or grouping. */
export default function FormSettings({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className='h-7 w-7'>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent side='bottom' align='center' sideOffset={8} className='w-60' data-testid='form-settings-menu'>
        <Layout currentLayout={DatabaseViewLayout.Form} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
