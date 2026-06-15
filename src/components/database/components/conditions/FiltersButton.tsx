import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { useAddFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useConditionsContext } from './context';

function FiltersButton({ toggleExpanded }: { toggleExpanded?: () => void }) {
  const filters = useFiltersSelector();
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const addFilter = useAddFilter();
  const conditionsContext = useConditionsContext();
  const setOpenFilterId = conditionsContext?.setOpenFilterId;
  const setExpanded = conditionsContext?.setExpanded;
  const prevFiltersLengthRef = useRef(filters.length);

  // Auto-expand conditions panel when first filter is added
  useEffect(() => {
    const prevLength = prevFiltersLengthRef.current;
    const currentLength = filters.length;

    // If filters went from 0 to 1+, expand the panel
    if (prevLength === 0 && currentLength > 0) {
      setExpanded?.(true);
    }

    prevFiltersLengthRef.current = currentLength;
  }, [filters.length, setExpanded]);

  return (
    <PropertiesMenu
      open={open}
      onOpenChange={setOpen}
      searchPlaceholder={t('grid.settings.filterBy')}
      onSelect={(fieldId) => {
        const filterId = addFilter(fieldId);

        setOpenFilterId?.(filterId);
      }}
      asChild
    >
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon'}
              className={'relative'}
              data-testid={'database-actions-filter'}
              onClick={(e) => {
                e.stopPropagation();
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
              <FilterIcon className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('grid.settings.filter')}</TooltipContent>
        </Tooltip>
      </div>
    </PropertiesMenu>
  );
}

export default FiltersButton;
