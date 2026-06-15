import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useAddSort } from '@/application/database-yjs/dispatch';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useConditionsContext } from './context';
import { useRollupSortableIds } from '../sorts/utils';


function SortsButton ({ toggleExpanded, expanded }: {
  toggleExpanded?: () => void;
  expanded?: boolean;
}) {
  const sorts = useSortsSelector();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const readOnly = useReadOnly();
  const addSort = useAddSort();
  const conditionsContext = useConditionsContext();
  const setExpanded = conditionsContext?.setExpanded;
  const prevSortsLengthRef = useRef(sorts.length);

  // Auto-expand conditions panel when first sort is added (e.g. synced from desktop)
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
      onSelect={fieldId => {
        addSort(fieldId);
        if (!expanded) {
          toggleExpanded?.();
        }
      }}
      excludedTypes={excludedTypes}
      propertyFilter={propertyFilter}
      asChild
    >
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon'}
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
                color: sorts.length > 0 ? 'var(--text-action)' : undefined,
              }}

            >
              <SortIcon className={'w-5 h-5'} />

            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('grid.settings.sort')}
          </TooltipContent>
        </Tooltip>
      </div>
    </PropertiesMenu>
  );
}

export default SortsButton;
