// import { useFiltersSelector, useSortsSelector } from '@/application/database-yjs';
// import { useConditionsContext } from '@/components/database/components/conditions/context';
import Settings from '@/components/database/components/settings/Settings';
import React from 'react';
import { useTranslation } from 'react-i18next';
// import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
// import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';

import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

export function DatabaseActions () {
  const { t } = useTranslation();

  // const sorts = useSortsSelector();
  // const filter = useFiltersSelector();
  // const conditionsContext = useConditionsContext();

  return (
    <div className="flex w-[120px] items-center justify-end gap-1.5">
      {/*<Tooltip>*/}
      {/*  <TooltipTrigger>*/}
      {/*    <Button*/}
      {/*      variant={'ghost'}*/}
      {/*      size={'icon'}*/}
      {/*      data-testid={'database-actions-filter'}*/}
      {/*      onClick={() => {*/}
      {/*        conditionsContext?.toggleExpanded();*/}
      {/*      }}*/}
      {/*      style={{*/}
      {/*        color: filter.length > 0 ? 'var(--text-action)' : undefined,*/}
      {/*      }}*/}

      {/*    >*/}
      {/*      <FilterIcon className={'w-5 h-5'} />*/}
      {/*    </Button>*/}
      {/*  </TooltipTrigger>*/}
      {/*  <TooltipContent>*/}
      {/*    {t('grid.settings.filter')}*/}
      {/*  </TooltipContent>*/}
      {/*</Tooltip>*/}
      {/*<Tooltip>*/}
      {/*  <TooltipTrigger>*/}
      {/*    <Button*/}
      {/*      variant={'ghost'}*/}
      {/*      size={'icon'}*/}
      {/*      data-testid={'database-actions-sort'}*/}
      {/*      onClick={() => {*/}
      {/*        conditionsContext?.toggleExpanded();*/}
      {/*      }}*/}
      {/*      style={{*/}
      {/*        color: sorts.length > 0 ? 'var(--text-action)' : undefined,*/}
      {/*      }}*/}

      {/*    >*/}
      {/*      <SortIcon className={'w-5 h-5'} />*/}
      {/*    </Button>*/}
      {/*  </TooltipTrigger>*/}
      {/*  <TooltipContent>*/}
      {/*    {t('grid.settings.sort')}*/}
      {/*  </TooltipContent>*/}
      {/*</Tooltip>*/}
      <Settings>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon'}
              data-testid={'database-actions-settings'}
            >
              <SettingsIcon className={'w-5 h-5'} />
            </Button>


          </TooltipTrigger>
          <TooltipContent>
            {t('settings.title')}
          </TooltipContent>
        </Tooltip>
      </Settings>
    </div>
  );
}

export default DatabaseActions;
