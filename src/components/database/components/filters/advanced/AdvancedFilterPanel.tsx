import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdvancedFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { useAddAdvancedFilter, useClearAllFilters } from '@/application/database-yjs/dispatch';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';

import { useConditionsContext } from '../../conditions/context';

import { FilterPanelRow } from './FilterPanelRow';

export function AdvancedFilterPanel() {
  const { t } = useTranslation();
  const filters = useAdvancedFiltersSelector();
  const readOnly = useReadOnly();

  const addFilter = useAddAdvancedFilter();
  const clearAllFilters = useClearAllFilters();

  const context = useConditionsContext();
  const setAdvancedMode = context?.setAdvancedMode;

  const [addFilterMenuOpen, setAddFilterMenuOpen] = useState(false);

  const handleAddFilter = useCallback(
    (fieldId: string) => {
      addFilter(fieldId);
      setAddFilterMenuOpen(false);
    },
    [addFilter]
  );

  const handleDeleteAllFilters = useCallback(() => {
    clearAllFilters();
    setAdvancedMode?.(false);
  }, [clearAllFilters, setAdvancedMode]);

  return (
    <div className='flex flex-col'>
      {/* Filter rows */}
      <div className='flex flex-col'>
        {filters.map((filter, index) => (
          <FilterPanelRow key={filter.id} filter={filter} isFirst={index === 0} />
        ))}
      </div>

      {/* Add filter rule button */}
      {!readOnly && (
        <div className='border-t border-line-divider px-2 py-1.5'>
          <PropertiesMenu
            asChild
            searchPlaceholder={t('grid.settings.filterBy')}
            onSelect={handleAddFilter}
            open={addFilterMenuOpen}
            onOpenChange={setAddFilterMenuOpen}
          >
            <button
              className='flex h-7 w-full items-center gap-2 rounded-md px-2 text-text-primary hover:bg-fill-list-hover'
              data-testid='add-advanced-filter-button'
            >
              <AddIcon className='h-4 w-4' />
              <span className='text-xs'>{t('grid.filter.addFilter')}</span>
            </button>
          </PropertiesMenu>
        </div>
      )}

      {/* Delete all filters button */}
      {!readOnly && filters.length > 0 && (
        <div className='px-2 py-1.5'>
          <button
            className='flex h-7 w-full items-center gap-2 rounded-md px-2 text-text-primary hover:bg-fill-list-hover'
            onClick={handleDeleteAllFilters}
            data-testid='delete-all-filters-button'
          >
            <DeleteIcon className='h-4 w-4' />
            <span className='text-xs'>{t('grid.settings.deleteFilter')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default AdvancedFilterPanel;
