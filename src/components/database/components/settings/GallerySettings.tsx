import { Children } from 'react';
import { useTranslation } from 'react-i18next';

import { DatabaseViewLayout } from '@/application/types';
import GalleryLayoutSettings, {
  GALLERY_POPOVER_SHELL_CLASS_NAME,
} from '@/components/database/components/settings/GalleryLayoutSettings';
import Layout from '@/components/database/components/settings/Layout';
import Properties from '@/components/database/components/settings/Properties';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

export function GallerySettings({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const settingsLabel = t('settings.title');
  const trigger = Children.only(children);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger aria-label={settingsLabel} asChild>
            {trigger}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{settingsLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='end'
        className={cn(GALLERY_POPOVER_SHELL_CLASS_NAME, 'w-[240px] !min-w-[240px] p-1.5')}
        side='bottom'
      >
        <DropdownMenuGroup>
          <Properties />
          <Layout currentLayout={DatabaseViewLayout.Gallery} />
          <GalleryLayoutSettings />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default GallerySettings;
