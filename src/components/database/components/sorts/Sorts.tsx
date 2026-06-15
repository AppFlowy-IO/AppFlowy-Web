import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useAddSort, useClearSortingDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as SortSvg } from '@/assets/icons/sort_ascending.svg';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import SortList from '@/components/database/components/sorts/SortList';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

import { useRollupSortableIds } from './utils';


export function Sorts () {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (!open) {
      setOpenPropertiesMenu(false);
    }
  }, [open]);

  if (sorts.length === 0) return null;
  return (
    <div className={'relative h-7'}>
      <Button
        variant={'outline'}
        size={'sm'}
        className={'rounded-full'}
        onClick={(e) => {
          e.stopPropagation();
          if (readOnly) return;
          setOpen(!open);
        }}
        data-testid={'database-sort-condition'}
      >
        <SortSvg className={'w-5 h-5'} />
        {t('grid.settings.sort')}
        <ArrowDown className={'w-5 h-5'} />

      </Button>
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
