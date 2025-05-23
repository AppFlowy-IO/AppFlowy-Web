import { useConditionsContext } from '@/components/database/components/conditions/context';
import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import Settings from '@/components/database/components/settings/Settings';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';

import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

export function DatabaseActions () {
  const { t } = useTranslation();

  const conditionsContext = useConditionsContext();

  return (
    <div className="flex w-[120px] items-center justify-end gap-1.5">
      <FiltersButton {...conditionsContext} />
      <SortsButton {...conditionsContext} />
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
