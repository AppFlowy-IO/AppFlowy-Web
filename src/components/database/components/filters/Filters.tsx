import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdvancedFiltersSelector, useFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { useAddAdvancedFilterAndRebuild, useAddFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as AddFilterSvg } from '@/assets/icons/plus.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import Filter from '@/components/database/components/filters/Filter';
import { Button } from '@/components/ui/button';

import { useConditionsContext } from '../conditions/context';

import { AdvancedFiltersBadge } from './advanced';
import { FILTER_EXCLUDED_FIELD_TYPES } from './filter-field-types';

export function Filters() {
  const filters = useFiltersSelector();
  const advancedFilters = useAdvancedFiltersSelector();
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const [openPropertiesMenu, setOpenPropertiesMenu] = useState(false);

  const addFilter = useAddFilter();
  const addAdvancedFilter = useAddAdvancedFilterAndRebuild();
  const isAdvanced = advancedFilters.length > 0;

  const context = useConditionsContext();
  const setOpenFilterId = context?.setOpenFilterId;
  const setAdvancedPanelOpen = context?.setAdvancedPanelOpen;

  // Desktop parity: a newly created filter immediately opens its editor —
  // the chip popover in normal mode, the rules panel in advanced mode.
  const handleAddFilter = useCallback(
    (fieldId: string) => {
      if (isAdvanced) {
        addAdvancedFilter(fieldId);
        setAdvancedPanelOpen?.(true);
        return;
      }

      const filterId = addFilter(fieldId);

      setOpenFilterId?.(filterId);
    },
    [addAdvancedFilter, addFilter, isAdvanced, setAdvancedPanelOpen, setOpenFilterId]
  );

  return (
    <>
      {isAdvanced ? (
        <AdvancedFiltersBadge count={advancedFilters.length} />
      ) : (
        <div className={'flex items-center gap-1.5'}>
          {filters.map((filter) => (
            <Filter filterId={filter.id} key={filter.id} />
          ))}
        </div>
      )}

      {readOnly ? null : (
        <PropertiesMenu
          asChild
          searchPlaceholder={t('grid.settings.filterBy')}
          excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
          onSelect={handleAddFilter}
          open={openPropertiesMenu}
          onOpenChange={setOpenPropertiesMenu}
        >
          <Button
            variant='ghost'
            className={'mx-1 h-7 whitespace-nowrap rounded-full font-medium text-text-secondary'}
            size='sm'
            data-testid='database-add-filter-button'
          >
            <AddFilterSvg className={'h-5 w-5 text-icon-secondary'} />
            {t('grid.settings.addFilter')}
          </Button>
        </PropertiesMenu>
      )}
    </>
  );
}

export default Filters;
