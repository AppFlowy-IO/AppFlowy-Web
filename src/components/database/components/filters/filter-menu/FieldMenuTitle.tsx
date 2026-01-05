import React from 'react';
import { useTranslation } from 'react-i18next';

import { useRemoveFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { FieldDisplay } from '@/components/database/components/field';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


function FieldMenuTitle ({ filterId, fieldId, renderConditionSelect }: {
  filterId: string;
  fieldId: string;
  renderConditionSelect: React.ReactNode;
}) {
  const deleteFilter = useRemoveFilter();

  const { t } = useTranslation();

  return (
    <div className={'flex text-text-primary text-sm items-center justify-between gap-2'}>
      <div className={'max-w-[100px] overflow-hidden'}>
        <FieldDisplay
          className={'truncate w-full'}
          fieldId={fieldId}
        />
      </div>
      <div className={'flex flex-1 items-center justify-end'}>
        {renderConditionSelect}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size={'icon-sm'}
            onClick={(e) => {
              e.stopPropagation();
              deleteFilter(filterId);
            }}
            variant={'ghost'}
            danger
            data-testid="delete-filter-button"
          >
            <DeleteIcon className={'w-5 h-5'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('grid.settings.deleteFilter')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export default FieldMenuTitle;
