import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function RelationView({ view }: { view: View }) {
  const { t } = useTranslation();

  return (
    <div className='flex w-full items-center gap-2 overflow-hidden'>
      <PageIcon className={'flex !h-5 !w-5 items-center justify-center text-xl'} iconSize={20} view={view} />

      <Tooltip disableHoverableContent delayDuration={1000}>
        <TooltipTrigger asChild>
          <div className={'flex-1 truncate'}>{view.name || t('menuAppHeader.defaultNewPageName')}</div>
        </TooltipTrigger>
        <TooltipContent side={'left'}>{view.name}</TooltipContent>
      </Tooltip>
    </div>
  );
}
