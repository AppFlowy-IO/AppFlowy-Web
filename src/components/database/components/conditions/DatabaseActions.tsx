import { useTranslation } from 'react-i18next';

import { useDatabaseContext, useDatabaseViewLayout } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import Settings from '@/components/database/components/settings/Settings';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function DatabaseActions() {
  const { t } = useTranslation();

  const layout = useDatabaseViewLayout() as DatabaseViewLayout;
  const conditionsContext = useConditionsContext();
  const { isDocumentBlock, navigateToView, databasePageId } = useDatabaseContext();

  const showSorts = [DatabaseViewLayout.Grid].includes(layout);

  return (
    <div className='flex w-[120px] items-center justify-end gap-1.5'>
      <FiltersButton {...conditionsContext} />
      {showSorts && <SortsButton {...conditionsContext} />}
      <Settings>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={'ghost'} size={'icon'} data-testid={'database-actions-settings'}>
              <SettingsIcon className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>

          <TooltipContent>{t('settings.title')}</TooltipContent>
        </Tooltip>
      </Settings>
      {isDocumentBlock && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon'}
              onClick={() => {
                if (!databasePageId) return;
                void navigateToView?.(databasePageId);
              }}
            >
              <ExpandMoreIcon className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>

          <TooltipContent>{t('tooltip.openAsPage')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default DatabaseActions;
