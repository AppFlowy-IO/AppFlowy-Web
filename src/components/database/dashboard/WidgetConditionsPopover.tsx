import { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  useAdvancedFiltersSelector,
  useConditionsReadOnly,
  useFiltersSelector,
  useSortsSelector,
} from '@/application/database-yjs';
import {
  useAddAdvancedFilterAndRebuild,
  useAddFilter,
  useAddSort,
  useClearSortingDispatch,
} from '@/application/database-yjs/dispatch';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { AdvancedFiltersBadge } from '@/components/database/components/filters/advanced';
import Filter from '@/components/database/components/filters/Filter';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import SortList from '@/components/database/components/sorts/SortList';
import { useRollupSortableIds } from '@/components/database/components/sorts/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

export type WidgetConditionsKind = 'filters' | 'sorts';

/** The rules of the widget's filters: chips stacked vertically (or the advanced rules), then "Add filter". */
export function WidgetFiltersBody() {
  const { t } = useTranslation();
  const filters = useFiltersSelector();
  const advancedFilters = useAdvancedFiltersSelector();
  const readOnly = useConditionsReadOnly();
  const addFilter = useAddFilter();
  const addAdvancedFilter = useAddAdvancedFilterAndRebuild();
  const context = useConditionsContext();
  const setOpenFilterId = context?.setOpenFilterId;
  const setAdvancedPanelOpen = context?.setAdvancedPanelOpen;
  const [addOpen, setAddOpen] = useState(false);
  const isAdvanced = advancedFilters.length > 0;

  // A new rule opens its editor at once (desktop parity): the chip popover,
  // or the rules panel in advanced mode.
  const handleAddFilter = useCallback(
    (fieldId: string) => {
      if (isAdvanced) {
        addAdvancedFilter(fieldId);
        setAdvancedPanelOpen?.(true);
        return;
      }

      setOpenFilterId?.(addFilter(fieldId));
    },
    [addAdvancedFilter, addFilter, isAdvanced, setAdvancedPanelOpen, setOpenFilterId]
  );

  return (
    <div className='flex flex-col items-start gap-1.5'>
      {isAdvanced ? (
        <AdvancedFiltersBadge count={advancedFilters.length} />
      ) : (
        filters.map((filter) => (
          <div className='max-w-full' data-parity-id='dash-widget-filters-popover-rule' key={filter.id}>
            <Filter filterId={filter.id} />
          </div>
        ))
      )}
      {readOnly ? null : (
        <PropertiesMenu
          asChild
          excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
          onOpenChange={setAddOpen}
          onSelect={handleAddFilter}
          open={addOpen}
          searchPlaceholder={t('grid.settings.filterBy')}
        >
          <Button
            className='h-7 whitespace-nowrap rounded-full px-2 font-medium text-text-secondary'
            data-testid='database-add-filter-button'
            size='sm'
            variant='ghost'
          >
            <PlusIcon aria-hidden='true' className='h-5 w-5 text-icon-secondary' />
            {t('grid.settings.addFilter')}
          </Button>
        </PropertiesMenu>
      )}
    </div>
  );
}

/** The widget's sorts: the reorderable sort list, then "Add sort" and "Delete all sorts". */
export function WidgetSortsBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const sorts = useSortsSelector();
  const readOnly = useConditionsReadOnly();
  const addSort = useAddSort();
  const deleteAllSorts = useClearSortingDispatch();
  const [addOpen, setAddOpen] = useState(false);
  const rollupSortableIds = useRollupSortableIds();
  const sortFieldIds = useMemo(() => sorts.map((sort) => sort.fieldId), [sorts]);
  const excludedTypes = useMemo(() => [FieldType.Person], []);
  const propertyFilter = useCallback(
    (property: { id: string; type: FieldType }) =>
      property.type !== FieldType.Rollup || rollupSortableIds.has(property.id),
    [rollupSortableIds]
  );

  return (
    <div className='flex flex-col'>
      <SortList />
      {readOnly ? null : (
        <div className='flex items-center justify-between pt-2'>
          <PropertiesMenu
            asChild
            excludedTypes={excludedTypes}
            filteredOut={sortFieldIds}
            onOpenChange={setAddOpen}
            onSelect={(fieldId) => addSort(fieldId)}
            open={addOpen}
            propertyFilter={propertyFilter}
            searchPlaceholder={t('grid.settings.sortBy')}
          >
            <Button data-testid='database-add-sort-button' size='sm' variant='ghost'>
              <PlusIcon aria-hidden='true' className='h-5 w-5' />
              {t('grid.sort.addSort')}
            </Button>
          </PropertiesMenu>
          <Button
            danger
            data-testid='database-delete-all-sorts-button'
            onClick={() => {
              deleteAllSorts();
              onClose();
            }}
            size='sm'
            variant='ghost'
          >
            <DeleteIcon aria-hidden='true' className='h-5 w-5' />
            {t('grid.sort.deleteAllSorts')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface WidgetConditionsPopoverProps {
  kind: WidgetConditionsKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The widget's filter or sort tool; the popover is anchored to it and gives it the focus back. */
  children: ReactNode;
  /** Bottom slot for the private-state actions (WP07). */
  footer?: ReactNode;
}

/**
 * The "Filters" or "Sorts" popover of a dashboard widget's tool: a widget has
 * no conditions bar inside its card, so its rules live here. 300px wide,
 * anchored under the tool, with a title and a round close button. Nested
 * editors (a chip's filter menu) close first on Escape.
 */
export function WidgetConditionsPopover({ kind, open, onOpenChange, children, footer }: WidgetConditionsPopoverProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const title =
    kind === 'filters'
      ? t('dashboard.widget.filters', { defaultValue: 'Filters' })
      : t('dashboard.widget.sorts', { defaultValue: 'Sorts' });
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <Popover modal onOpenChange={onOpenChange} open={open}>
      <PopoverAnchor asChild>
        <div className='flex' data-state={open ? 'open' : 'closed'} ref={anchorRef}>
          {children}
        </div>
      </PopoverAnchor>
      {open ? (
        <PopoverContent
          align='end'
          className='w-[300px] !rounded-[10px] bg-surface-primary p-2'
          data-parity-id={kind === 'filters' ? 'dash-widget-filters-popover' : 'dash-widget-sorts-popover'}
          data-testid={`dashboard-widget-${kind}-popover`}
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const tool = anchorRef.current?.querySelector<HTMLElement>('button');

            if (tool?.isConnected) tool.focus();
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          sideOffset={4}
        >
          <div className='mb-1.5 flex items-center gap-2 pl-1'>
            <span
              className='flex-1 truncate text-sm font-semibold text-text-primary'
              data-parity-id={kind === 'filters' ? 'dash-widget-filters-popover__title' : undefined}
            >
              {title}
            </span>
            <Button
              aria-label={t('dashboard.widget.close', { defaultValue: 'Close' })}
              className='!rounded-full text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'
              data-parity-id={kind === 'filters' ? 'dash-widget-filters-popover-close' : undefined}
              data-testid={`dashboard-widget-${kind}-popover-close`}
              onClick={close}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <CloseIcon aria-hidden='true' />
            </Button>
          </div>
          {kind === 'filters' ? <WidgetFiltersBody /> : <WidgetSortsBody onClose={close} />}
          {footer ? <div data-slot='widget-conditions-footer'>{footer}</div> : null}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

export default WidgetConditionsPopover;
