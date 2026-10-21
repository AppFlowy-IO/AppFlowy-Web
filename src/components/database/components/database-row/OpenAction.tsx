import { useTranslation } from 'react-i18next';

import { useDatabaseContextOptional, useNavigateToRow } from '@/application/database-yjs';
import { ReactComponent as CenterPeekIcon } from '@/assets/icons/center_peek.svg';
import { ReactComponent as SidePeekIcon } from '@/assets/icons/side_peek.svg';
import { useRowPeekLayout } from '@/components/database/row-peek/RowPeekLayout';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function OpenAction({ rowId }: { rowId: string }) {
  const navigateToRow = useNavigateToRow();
  const context = useDatabaseContextOptional();
  const layout = useRowPeekLayout();
  const { t } = useTranslation();
  const side = layout?.canShow === true && !context?.openPageModalViewId;
  const label = t(side ? 'grid.rowPage.openAsSidePeekPanel' : 'grid.rowPage.openAsCenterPeekPanel');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={'icon-sm'}
          variant={'outline'}
          data-testid='row-expand-button'
          aria-label={label}
          className={
            'h-[26px] w-[26px] rounded-[6px] bg-surface-primary text-icon-primary hover:bg-surface-primary-hover focus-visible:ring-2 focus-visible:ring-border-theme-thick'
          }
          onClick={(e) => {
            e.stopPropagation();
            navigateToRow?.(rowId);
          }}
        >
          {side ? <SidePeekIcon aria-hidden className='h-5 w-5' /> : <CenterPeekIcon aria-hidden className='h-5 w-5' />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side='top' className='rounded-lg'>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default OpenAction;
