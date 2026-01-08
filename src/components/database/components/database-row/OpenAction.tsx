import { useTranslation } from 'react-i18next';

import { useNavigateToRow } from '@/application/database-yjs';
import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/full_screen.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function OpenAction({ rowId }: { rowId: string }) {
  const navigateToRow = useNavigateToRow();

  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={'icon-sm'}
          variant={'outline'}
          data-testid="row-expand-button"
          className={'bg-surface-primary text-icon-secondary hover:bg-surface-primary-hover'}
          onClick={(e) => {
            e.stopPropagation();
            navigateToRow?.(rowId);
          }}
        >
          <ExpandMoreIcon className={'h-5 w-5'} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={'right'}>{t('tooltip.openAsPage')}</TooltipContent>
    </Tooltip>
  );
}

export default OpenAction;
