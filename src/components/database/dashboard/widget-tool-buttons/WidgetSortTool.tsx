import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useConditionsReadOnly, useSortsSelector } from '@/application/database-yjs';
import { useAddSort } from '@/application/database-yjs/dispatch';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { useRollupSortableIds } from '@/components/database/components/sorts/utils';

import { UnsavedDot } from '../private/UnsavedDot';
import { useWidgetPrivateSnapshot } from '../private/WidgetPrivateContext';
import { WidgetConditionsPopover } from '../WidgetConditionsPopover';
import { useWidgetContext } from '../WidgetContext';

import { WidgetToolButton } from './WidgetToolButton';

/**
 * A widget's Sort tool. It opens the widget's "Sorts" popover; with no sort
 * yet, a writer picks a property first and the popover opens on the new sort
 * (desktop parity). The popover state is the widget's conditions context, so
 * the column header's "Sort" opens it too.
 */
export function WidgetSortTool() {
  const { t } = useTranslation();
  const sorts = useSortsSelector();
  const readOnly = useConditionsReadOnly();
  const addSort = useAddSort();
  const conditions = useConditionsContext();
  const { editing } = useWidgetContext();
  const [pickerOpen, setPickerOpen] = useState(false);
  // The widget's sorts differ from its saved view (WP07): the orange dot.
  const unsaved = Boolean(useWidgetPrivateSnapshot()?.sorts);
  const rollupSortableIds = useRollupSortableIds();
  const propertyFilter = useCallback(
    (property: { id: string; type: FieldType }) =>
      property.type !== FieldType.Rollup || rollupSortableIds.has(property.id),
    [rollupSortableIds]
  );
  const excludedTypes = useMemo(() => [FieldType.Person], []);
  const active = sorts.length > 0;

  return (
    <WidgetConditionsPopover
      kind='sorts'
      onOpenChange={(next) => conditions?.setSortMenuOpen?.(next)}
      open={Boolean(conditions?.sortMenuOpen)}
    >
      <PropertiesMenu
        asChild
        excludedTypes={excludedTypes}
        onOpenChange={setPickerOpen}
        onSelect={(fieldId) => {
          addSort(fieldId);
          conditions?.setSortMenuOpen?.(true);
        }}
        open={pickerOpen}
        propertyFilter={propertyFilter}
        searchPlaceholder={t('grid.settings.sortBy')}
      >
        <div>
          <WidgetToolButton
            accent={editing}
            badge={unsaved ? <UnsavedDot placement='tool' testId='database-actions-sort-dot' /> : null}
            className='relative'
            data-active={String(active)}
            data-unsaved={String(unsaved)}
            data-testid='database-actions-sort'
            icon={SortIcon}
            iconClassName='h-5 w-5'
            label={t('grid.settings.sort')}
            onClick={(event) => {
              event.stopPropagation();
              // No sorts (and nothing unsaved to reset): pick a property first. Otherwise toggle the popover.
              if (!readOnly && !active && !unsaved) setPickerOpen(true);
              else conditions?.setSortMenuOpen?.(!conditions.sortMenuOpen);
            }}
            parityId='dash-widget-tool-sort'
          />
        </div>
      </PropertiesMenu>
    </WidgetConditionsPopover>
  );
}

export default WidgetSortTool;
