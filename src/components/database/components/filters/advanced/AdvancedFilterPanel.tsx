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
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  const setAdvancedPanelOpen = context?.setAdvancedPanelOpen;

  const [addFilterMenuOpen, setAddFilterMenuOpen] = useState(false);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);

  const handleAddFilter = useCallback(
    (fieldId: string) => {
      addFilter(fieldId);
      setAddFilterMenuOpen(false);
    },
    [addFilter]
  );

  // Desktop parity: "Delete filter" in the panel footer asks for confirmation
  // before removing every filter from the view.
  const handleDeleteAllFilters = useCallback(() => {
    clearAllFilters();
    setDeleteAllConfirmOpen(false);
    setAdvancedPanelOpen?.(false);
    setAdvancedMode?.(false);
  }, [clearAllFilters, setAdvancedMode, setAdvancedPanelOpen]);

  const handleOperatorChange = useCallback(
    (filterId: string, newOperator: FilterType.And | FilterType.Or) => {
      const drafts: FilterDraft[] = filters.map((f, index) => ({
        id: f.id,
        fieldId: f.fieldId,
        fieldType: f.fieldType ?? 0,
        rollupTargetFieldType: f.rollupTargetFieldType,
        condition: f.condition,
        content: f.content,
        operator: f.id === filterId ? newOperator : (index === 0 ? null : f.operator ?? FilterType.And),
      }));

      rebuildTree(drafts);
    },
    [filters, rebuildTree]
  );

  return (
    <div className='flex flex-col pb-2 pt-3'>
      {/* Filter rows */}
      <div className='appflowy-scroller flex max-h-[320px] flex-col gap-1.5 overflow-y-auto'>
        {filters.map((filter, index) => (
          <FilterPanelRow
            key={filter.id}
            filter={filter}
            isFirst={index === 0}
            onOperatorChange={handleOperatorChange}
          />
        ))}
      </div>

      {!readOnly && <div className='mx-2 mb-1 mt-3 border-t border-border-primary' />}

      {/* Add filter rule button */}
      {!readOnly && (
        <div className='px-2'>
          <PropertiesMenu
            asChild
            searchPlaceholder={t('grid.settings.filterBy')}
            excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
            onSelect={handleAddFilter}
            open={addFilterMenuOpen}
            onOpenChange={setAddFilterMenuOpen}
          >
            <button
              className='flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary hover:bg-fill-content-hover'
              data-testid='add-advanced-filter-button'
            >
              <AddIcon className='h-5 w-5 text-icon-primary' />
              {t('grid.filter.addFilterRule')}
            </button>
          </PropertiesMenu>
        </div>
      )}

      {/* Delete all filters button */}
      {!readOnly && filters.length > 0 && (
        <div className='px-2'>
          <button
            className='group flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary hover:bg-fill-content-hover hover:text-text-error'
            onClick={() => setDeleteAllConfirmOpen(true)}
            data-testid='delete-all-filters-button'
          >
            <DeleteIcon className='h-5 w-5 text-icon-primary group-hover:text-icon-error-thick' />
            {t('grid.settings.deleteFilter')}
          </button>
        </div>
      )}

      <Dialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('grid.settings.deleteFilterConfirmationTitle')}</DialogTitle>
          </DialogHeader>
          <DialogDescription>{t('grid.settings.deleteFilterConfirmationDescription')}</DialogDescription>
          <DialogFooter>
            <Button variant={'outline'} onClick={() => setDeleteAllConfirmOpen(false)}>
              {t('button.cancel')}
            </Button>
            <Button
              variant={'destructive'}
              data-testid='confirm-delete-all-filters'
              onClick={handleDeleteAllFilters}
            >
              {t('button.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AdvancedFilterPanel;
