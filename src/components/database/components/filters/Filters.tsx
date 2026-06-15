import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdvancedFiltersSelector, useFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { useAddFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as AddFilterSvg } from '@/assets/icons/plus.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import Filter from '@/components/database/components/filters/Filter';
import { Button } from '@/components/ui/button';

import { useConditionsContext } from '../conditions/context';

import { AdvancedFiltersBadge } from './advanced';

export function Filters() {
  const filters = useFiltersSelector();
  const advancedFilters = useAdvancedFiltersSelector();
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const [openPropertiesMenu, setOpenPropertiesMenu] = useState(false);

  const addFilter = useAddFilter();

  const context = useConditionsContext();
  const setOpenFilterId = context?.setOpenFilterId;

  const handleAddFilter = useCallback(
    (fieldId: string) => {
      const filterId = addFilter(fieldId);

      setOpenFilterId?.(filterId);
    },
    [addFilter, setOpenFilterId]
  );

  // In advanced mode (hierarchical filters), show badge instead of individual filter chips
  // The selector returns non-empty array only when filters are in hierarchical structure
  if (advancedFilters.length > 0) {
    return <AdvancedFiltersBadge count={advancedFilters.length} />;
  }

  return (
    <>
      <div className={'flex items-center gap-1'}>
        {filters.map((filter) => (
          <Filter filterId={filter.id} key={filter.id} />
        ))}
      </div>

      {readOnly ? null : (
        <PropertiesMenu
          asChild
          searchPlaceholder={t('grid.settings.filterBy')}
          onSelect={handleAddFilter}
          open={openPropertiesMenu}
          onOpenChange={setOpenPropertiesMenu}
        >
          <Button
            variant='ghost'
            className={'mx-1 whitespace-nowrap'}
            size='sm'
            data-testid='database-add-filter-button'
          >
            <AddFilterSvg className={'h-5 w-5'} />
            {t('grid.settings.addFilter')}
          </Button>
        </PropertiesMenu>
      )}
    </>
  );
}

export default Filters;
