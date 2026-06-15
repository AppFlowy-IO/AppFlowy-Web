import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAdvancedFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { FilterType } from '@/application/database-yjs/database.type';
import { FilterDraft } from '@/application/database-yjs/filter';
import {
  useAddAdvancedFilterAndRebuild,
  useClearAllFilters,
  useRebuildFilterTree,
} from '@/application/database-yjs/dispatch';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';

import { useConditionsContext } from '../../conditions/context';

import { FilterPanelRow } from './FilterPanelRow';

export function AdvancedFilterPanel() {
  const { t } = useTranslation();
  const filters = useAdvancedFiltersSelector();
  const readOnly = useReadOnly();

  const addFilter = useAddAdvancedFilterAndRebuild();
  const clearAllFilters = useClearAllFilters();
  const rebuildTree = useRebuildFilterTree();

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

  const handleOperatorChange = useCallback(
    (filterId: string, newOperator: FilterType.And | FilterType.Or) => {
      const drafts: FilterDraft[] = filters.map((f, index) => ({
        id: f.id,
        fieldId: f.fieldId,
        fieldType: f.fieldType ?? 0,
        condition: f.condition,
        content: f.content,
        operator: f.id === filterId ? newOperator : (index === 0 ? null : f.operator ?? FilterType.And),
      }));

      rebuildTree(drafts);
    },
    [filters, rebuildTree]
  );

  return (
    <div className='flex flex-col'>
      {/* Filter rows */}
      <div className='flex flex-col'>
        {filters.map((filter, index) => (
          <FilterPanelRow
            key={filter.id}
            filter={filter}
            isFirst={index === 0}
            onOperatorChange={handleOperatorChange}
          />
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
