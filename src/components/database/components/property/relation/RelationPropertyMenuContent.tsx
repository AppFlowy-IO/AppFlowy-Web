import { View } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useRelationData } from '@/components/database/components/property/relation/useRelationData';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import {
  DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';

function RelationPropertyMenuContent ({ fieldId }: {
  fieldId: string
}) {
  const { t } = useTranslation();
  const {
    loading,
    relations,
    relatedViewId,
    selectedView,
    setSelectedView,
    onUpdateDatabaseId,
    views,
  } = useRelationData(fieldId);

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
    <>
      <PropertySelectTrigger fieldId={fieldId} />
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.relation.relatedDatabasePlaceLabel')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {loading ? (
              <Progress variant={'primary'} />) : selectedView ? renderView(selectedView) : t('grid.relation.relatedDatabasePlaceholder')}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              className={'max-h-[450px] max-w-[240px] appflowy-scroller overflow-y-auto'}
            >
              {views.map((view) => (
                <DropdownMenuItem
                  key={view.view_id}
                  onSelect={() => {
                    setSelectedView(view);
                    const databaseId = Object.entries(relations || []).find(([, id]) => id === view.view_id)?.[0];

                    if (databaseId) {
                      onUpdateDatabaseId(databaseId);
                    }
                  }}
                >
                  {renderView(view)}

                  {view.view_id === relatedViewId && (<DropdownMenuItemTick />)}

                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </>
  );
}

export default RelationPropertyMenuContent;