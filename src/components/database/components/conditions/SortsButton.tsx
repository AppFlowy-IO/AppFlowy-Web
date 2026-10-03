import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useConditionsReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useAddSort } from '@/application/database-yjs/dispatch';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useRollupSortableIds } from '../sorts/utils';

import { useConditionsContext } from './context';

/**
 * The toolbar's Sort button. It reveals the conditions bar (the state of the
 * conditions context), or opens the property picker when there is no sort
 * yet. A dashboard widget has its own tool (`WidgetSortTool`).
 */
function SortsButton({ compact = false }: { compact?: boolean }) {
  const sorts = useSortsSelector();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const readOnly = useConditionsReadOnly();
  const addSort = useAddSort();
  const conditionsContext = useConditionsContext();
  const expanded = conditionsContext?.expanded;
  const toggleExpanded = conditionsContext?.toggleExpanded;
  const setExpanded = conditionsContext?.setExpanded;
  const setSortMenuOpen = conditionsContext?.setSortMenuOpen;
  const prevSortsLengthRef = useRef(sorts.length);
  const active = sorts.length > 0;

  // Auto-expand conditions panel when first sort is added (e.g. synced from desktop).
  useEffect(() => {
    const prevLength = prevSortsLengthRef.current;
    const currentLength = sorts.length;

    if (prevLength === 0 && currentLength > 0) {
      setExpanded?.(true);
    }

    prevSortsLengthRef.current = currentLength;
  }, [sorts.length, setExpanded]);

  const rollupSortableIds = useRollupSortableIds();
  const propertyFilter = useCallback(
    (property: { id: string; type: FieldType }) => {
      if (property.type !== FieldType.Rollup) return true;
      return rollupSortableIds.has(property.id);
    },
    [rollupSortableIds]
  );
  const excludedTypes = useMemo(() => [FieldType.Person], []);

  return (
    <PropertiesMenu
      open={open}
      onOpenChange={setOpen}
      searchPlaceholder={t('grid.settings.sortBy')}
      onSelect={(fieldId) => {
        addSort(fieldId);
        if (!expanded) {
          toggleExpanded?.();
        }

        // Desktop parity: adding a sort from the toolbar opens the sort editor.
        setSortMenuOpen?.(true);
      }}
      excludedTypes={excludedTypes}
      propertyFilter={propertyFilter}
      asChild
    >
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('grid.settings.sort')}
              variant={'ghost'}
              size={compact ? 'icon-sm' : 'icon'}
              data-testid={'database-actions-sort'}
              className={'relative'}
              onClick={(e) => {
                e.stopPropagation();
                if (readOnly || sorts.length > 0) {
                  toggleExpanded?.();
                } else {
                  setOpen(true);
                }
              }}
              style={{
                color: active ? 'var(--icon-info-thick)' : undefined,
              }}
              type='button'
            >
              <SortIcon aria-hidden='true' className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('grid.settings.sort')}</TooltipContent>
        </Tooltip>
      </div>
    </PropertiesMenu>
  );
}

export default SortsButton;
