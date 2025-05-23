import { useReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useAddSort } from '@/application/database-yjs/dispatch';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { useState } from 'react';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import { useTranslation } from 'react-i18next';

function SortsButton ({ toggleExpanded, expanded }: {
  toggleExpanded?: () => void;
  expanded?: boolean;
}) {
  const sorts = useSortsSelector();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const readOnly = useReadOnly();
  const addSort = useAddSort();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={'ghost'}
          size={'icon'}
          data-testid={'database-actions-sort'}
          className={'relative'}
          onClick={() => {
            if (readOnly || sorts.length > 0) {
              toggleExpanded?.();
            } else {
              setOpen(true);
            }
          }}
          style={{
            color: sorts.length > 0 ? 'var(--text-action)' : undefined,
          }}

        >
          <SortIcon className={'w-5 h-5'} />
          <PropertiesMenu
            open={open}
            onOpenChange={setOpen}
            searchPlaceholder={t('grid.settings.sortBy')}
            onSelect={fieldId => {
              addSort(fieldId);
              if (!expanded) {

                toggleExpanded?.();
              }
            }}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t('grid.settings.sort')}
      </TooltipContent>
    </Tooltip>
  );
}

export default SortsButton;