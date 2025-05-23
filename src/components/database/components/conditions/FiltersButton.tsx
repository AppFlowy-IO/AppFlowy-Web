import { useFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { useAddFilter } from '@/application/database-yjs/dispatch';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { useState } from 'react';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { useTranslation } from 'react-i18next';

function FiltersButton ({ toggleExpanded, expanded }: {
  toggleExpanded?: () => void; expanded?: boolean;
}) {
  const filters = useFiltersSelector();
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const addFilter = useAddFilter();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={'ghost'}
          size={'icon'}
          className={'relative'}
          data-testid={'database-actions-filter'}
          onClick={() => {
            if (readOnly || filters.length > 0) {
              toggleExpanded?.();
            } else {
              setOpen(true);
            }
          }}
          style={{
            color: filters.length > 0 ? 'var(--text-action)' : undefined,
          }}

        >
          <FilterIcon className={'w-5 h-5'} />
          <PropertiesMenu
            open={open}
            onOpenChange={setOpen}
            searchPlaceholder={t('grid.settings.filterBy')}
            onSelect={fieldId => {
              addFilter(fieldId);
              if (!expanded) {

                toggleExpanded?.();
              }
            }}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t('grid.settings.filter')}
      </TooltipContent>
    </Tooltip>
  );
}

export default FiltersButton;