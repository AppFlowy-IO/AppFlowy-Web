import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  SortCondition,
  useFieldSelector,
  useReadOnly,
  useSortSelector,
  useSortsSelector,
} from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { useAddSort, useClearSortingDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as AscendingSvg } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as DescendingSvg } from '@/assets/icons/arrow_down.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as SortSvg } from '@/assets/icons/sort.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import SortList from '@/components/database/components/sorts/SortList';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

import { useConditionsContext } from '../conditions/context';

import { useRollupSortableIds } from './utils';


export function Sorts () {
  const { t } = useTranslation();
  const context = useConditionsContext();
  const [localOpen, setLocalOpen] = useState(false);
  const open = context?.sortMenuOpen ?? localOpen;
  // Depend on the stable setter, not the context object, whose identity
  // changes whenever any unrelated conditions state changes.
  const setSortMenuOpen = context?.setSortMenuOpen;
  const setOpen = useCallback(
    (open: boolean) => {
      setSortMenuOpen?.(open);
      setLocalOpen(open);
    },
    [setSortMenuOpen]
  );
  const sorts = useSortsSelector();

  const sortFieldIds = useMemo(() => {
    return sorts.map(sort => sort.fieldId);
  }, [sorts]);

  const addSort = useAddSort();
  const deleteAllSorts = useClearSortingDispatch();
  const [openPropertiesMenu, setOpenPropertiesMenu] = useState(false);

  const readOnly = useReadOnly();
  const rollupSortableIds = useRollupSortableIds();
  const propertyFilter = useCallback(
    (property: { id: string; type: FieldType }) => {
      if (property.type !== FieldType.Rollup) return true;
      return rollupSortableIds.has(property.id);
    },
    [rollupSortableIds]
  );
  const excludedTypes = useMemo(() => [FieldType.Person], []);

  // Desktop parity: with exactly one sort the chip shows the sorted field's
  // name and an ascending/descending arrow; with several it shows "N sorts".
  const singleSortRef = sorts.length === 1 ? sorts[0] : undefined;
  const singleSort = useSortSelector(singleSortRef?.id ?? '');
  const { field: singleSortField } = useFieldSelector(singleSortRef?.fieldId ?? '');
  const label = singleSortRef
    ? singleSortField?.get(YjsDatabaseKey.name) ?? t('grid.settings.sort')
    : `${sorts.length} ${t('grid.sort.sorts')}`;
  const SortChipIcon = singleSortRef
    ? singleSort?.condition === SortCondition.Descending
      ? DescendingSvg
      : AscendingSvg
    : SortSvg;

  useEffect(() => {
    if (!open) {
      setOpenPropertiesMenu(false);
    }
  }, [open]);

  if (sorts.length === 0) return null;
  return (
    <div className={'relative h-7'}>
      <button
        className={
          'flex h-7 items-center rounded-full border border-border-theme-thick bg-fill-theme-select px-2 py-1 outline-none'
        }
        onClick={(e) => {
          e.stopPropagation();
          if (readOnly) return;
          setOpen(!open);
        }}
        data-testid={'database-sort-condition'}
      >
        <SortChipIcon className={'h-4 w-4 text-other-colors-text-event'} />
        <span className={'ml-1 max-w-[200px] truncate whitespace-nowrap text-sm font-medium text-other-colors-text-event'}>
          {label}
        </span>
        <ArrowDown className={'ml-1 h-5 w-5 text-icon-info-thick'} />
      </button>
      {open && (
        <Popover
          open={open}
          onOpenChange={setOpen}
          modal
        >
          <PopoverTrigger asChild>
            <div className={'absolute top-0 left-0 w-full h-full z-[-1]'} />
          </PopoverTrigger>
          <PopoverContent
            onOpenAutoFocus={e => e.preventDefault()}
            className={'p-2 max-h-[360px] appflowy-scroller overflow-y-auto'}
            onClick={e => {
              e.stopPropagation();
            }}
          >
            <SortList />
            {!readOnly && <div className={'flex pt-2 items-center justify-between'}>
              <div className={'relative'}>
                <PropertiesMenu
                  asChild
                  searchPlaceholder={t('grid.settings.sortBy')}
                  onSelect={fieldId => {
                    addSort(fieldId);
                  }}
                  filteredOut={sortFieldIds}
                  excludedTypes={excludedTypes}
                  propertyFilter={propertyFilter}
                  open={openPropertiesMenu}
                  onOpenChange={setOpenPropertiesMenu}
                >
                  <Button
                    size={'sm'}
                    onClick={() => setOpenPropertiesMenu(!openPropertiesMenu)}
                    variant={'ghost'}
                  >
                    <AddIcon className={'w-5 h-5'} />
                    {t('grid.sort.addSort')}
                  </Button>
                </PropertiesMenu>

              </div>

              <Button
                size={'sm'}
                onClick={() => {
                  deleteAllSorts();
                  setOpen(false);
                }}
                danger
                variant={'ghost'}
              >
                <DeleteIcon className={'w-5 h-5'} />
                {t('grid.sort.deleteAllSorts')}
              </Button>
            </div>}

          </PopoverContent>

        </Popover>
      )}
    </div>
  );
}

export default Sorts;
