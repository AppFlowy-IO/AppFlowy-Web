import { ReactComponent as ExpandMoreIcon } from '@/assets/icons/expand.svg';

import { useTranslation } from 'react-i18next';
import { useNavigateToRow } from '@/application/database-yjs';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import React from 'react';

function OpenAction ({ rowId }: { rowId: string }) {
  const navigateToRow = useNavigateToRow();

  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          color={'primary'}
          className={'rounded border border-border-primary w-5 h-5 flex items-center justify-center bg-surface-primary p-1 hover:bg-surface-primary-hover'}
          onClick={() => {
            navigateToRow?.(rowId);
          }}
        >
          <ExpandMoreIcon />
        </button>
      </TooltipTrigger>
      <TooltipContent side={'right'}>
        {t('tooltip.openAsPage')}
      </TooltipContent>

    </Tooltip>
  );
}

export default OpenAction;
