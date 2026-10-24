import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
// Imported from its module: `dispatch.ts` shadows the folder's index in Vite.
import { useMoveFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { DragContext, useDragContextValue } from '@/components/database/components/drag-and-drop/useDragContext';
import { AdvancedFiltersBadge } from '@/components/database/components/filters/advanced';
import Filter from '@/components/database/components/filters/Filter';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import SortList from '@/components/database/components/sorts/SortList';
import { useRollupSortableIds } from '@/components/database/components/sorts/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

import { WidgetPrivateFooter } from './private/WidgetPrivateFooter';

export type WidgetConditionsKind = 'filters' | 'sorts';

/**
 * The top-level rules, reorderable with a drag handle (WP07 R7). A move is
 * written to the view the widget shows: its private copy in View mode, the
 * saved view in Edit mode. A pure reorder changes no rows, so it never puts
 * an unsaved dot on the Filter tool.
 */
function WidgetFilterRules({ filterIds }: { filterIds: string[] }) {
  const { t } = useTranslation();
  const readOnly = useConditionsReadOnly();
  const moveFilter = useMoveFilter();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const data = useMemo(() => filterIds.map((id) => ({ id })), [filterIds]);
  const onReorder = useCallback(
    ({ oldData, startIndex, finishIndex }: { oldData: { id: string }[]; startIndex: number; finishIndex: number }) => {
      const id = oldData[startIndex]?.id;

      if (id) moveFilter(id, finishIndex);
    },
    [moveFilter]
  );
  const dragValue = useDragContextValue({ enabled: !readOnly, data, reorderAction: onReorder, container });
  const handleLabel = t('grid.row.drag', { defaultValue: 'Drag to move' });

  return (
    <div className='flex w-full flex-col items-start gap-1.5' ref={setContainer}>
      <DragContext.Provider value={dragValue}>
        {filterIds.map((id, index) => (
          <div className='max-w-full' data-parity-id='dash-widget-filters-popover-rule' key={id}>
            <DragItem
              className='gap-0.5'
              dragHandleLabel={handleLabel}
              dragHandleVisibility='hover'
              dragIcon={
                <DragIcon
                  aria-hidden='true'
                  className='h-4 w-4 text-icon-secondary'
                  data-parity-id='dash-widget-filters-popover-rule__drag-icon'
                />
              }
              id={id}
              onMoveDown={index < filterIds.length - 1 ? () => moveFilter(id, index + 1) : undefined}
              onMoveUp={index > 0 ? () => moveFilter(id, index - 1) : undefined}
            >
              <Filter filterId={id} />
            </DragItem>
          </div>
        ))}
      </DragContext.Provider>
    </div>
  );
}

/**
 * The rules of the widget's filters: chips stacked vertically (or the advanced
 * rules), then "Add filter". `initialAddOpen` opens the property picker of
 * "Add filter" at once (the phone's filter sheet without a rule, WP14 §1.4.2).
 */
export function WidgetFiltersBody({ initialAddOpen = false }: { initialAddOpen?: boolean } = {}) {
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
  const landOnPickerRef = useRef(initialAddOpen && !readOnly);

  // The picker opens on the next frame, once the sheet around the panel has
  // mounted: its layer then sits above the sheet's (focus and outside presses).
  useEffect(() => {
    if (!landOnPickerRef.current) return;
    const frame = requestAnimationFrame(() => {
      landOnPickerRef.current = false;
      setAddOpen(true);
    });

    return () => cancelAnimationFrame(frame);
  }, []);
  const isAdvanced = advancedFilters.length > 0;
  const filterIdsKey = filters.map((filter) => filter.id).join('\n');
  const filterIds = useMemo(() => (filterIdsKey ? filterIdsKey.split('\n') : []), [filterIdsKey]);

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
        <WidgetFilterRules filterIds={filterIds} />
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

/**
 * A widget's filter panel outside its popover: the phone's "Filter" sheet
 * (WP14 §1.4.2). The rules and "Add filter" as in the popover, then the
 * private-state footer (WP07). `landOnPicker` starts on the property picker.
 */
export function WidgetFiltersPanel({ landOnPicker = false }: { landOnPicker?: boolean }) {
  return (
    <div className='flex flex-col pt-1' data-testid='dashboard-widget-filters-panel'>
      <WidgetFiltersBody initialAddOpen={landOnPicker} />
      {/* Reset and "Save for everyone" while this widget's filters or sorts are private (WP07). */}
      <WidgetPrivateFooter />
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
  /** Extra content after the rules; the private-state footer (WP07) always follows. */
  footer?: ReactNode;
}

/**
 * The "Filters" or "Sorts" popover of a dashboard widget's tool: a widget has
 * no conditions bar inside its card, so its rules live here. 300px wide,
 * anchored under the tool, with a title and a round close button. Nested
 * editors (a chip's filter menu) close first on Escape. A backdrop popover:
 * modal behaviour without a whole-page restyle on open and close (W11).
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
    <Popover modal='backdrop' onOpenChange={onOpenChange} open={open}>
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
          {/* Reset and "Save for everyone" while this widget's filters or sorts are private (WP07). */}
          <WidgetPrivateFooter />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

export default WidgetConditionsPopover;
