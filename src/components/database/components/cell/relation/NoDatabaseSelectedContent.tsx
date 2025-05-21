import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { dropdownMenuItemVariants, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import React, { useCallback } from 'react';
import { View } from '@/application/types';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function NoDatabaseSelectedContent ({ views, onSelect, loading }: {
  views: View[];
  loading: boolean;
  onSelect: (view: View) => void
}) {
  const { t } = useTranslation();
  const renderView = useCallback((view: View) => {
    return <>
      <PageIcon
        className={'!w-5 !h-5 text-xl flex items-center justify-center'}
        iconSize={20}
        view={view}
      />

      <Tooltip
        disableHoverableContent
        delayDuration={1000}
      >
        <TooltipTrigger asChild>
          <div className={'flex-1 truncate'}>{view.name || t('menuAppHeader.defaultNewPageName')}</div>
        </TooltipTrigger>
        <TooltipContent side={'left'}>
          {view.name}
        </TooltipContent>
      </Tooltip>
    </>;
  }, [t]);

  return (
    <div className={'flex flex-col max-h-[450px] max-w-[320px] appflowy-scroller overflow-y-auto'}>
      <div className={'p-2'}><DropdownMenuLabel>
        {t('grid.relation.noDatabaseSelected')}
      </DropdownMenuLabel></div>

      <Separator />
      <div className={'px-2 min-h-[200px] relative py-1.5 flex flex-col'}>
        {loading &&
          <div className={'absolute flex items-center justify-center top-0 z-10 left-0 w-full h-full bg-surface-primary'}>
            <Progress variant={'primary'} /></div>}
        {views.map((view) => {
          return (
            <div
              key={view.view_id}
              className={dropdownMenuItemVariants({ variant: 'default' })}
              onClick={() => onSelect(view)}
            >
              {renderView(view)}
            </div>
          );
        })}
      </div>

    </div>
  );
}

export default NoDatabaseSelectedContent;