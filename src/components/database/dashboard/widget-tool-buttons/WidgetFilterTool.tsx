import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConditionsReadOnly, useFiltersSelector } from '@/application/database-yjs';
import { useAddFilter } from '@/application/database-yjs/dispatch';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';

import { UnsavedDot } from '../private/UnsavedDot';
import { useWidgetPrivateSnapshot } from '../private/WidgetPrivateContext';
import { WidgetConditionsPopover } from '../WidgetConditionsPopover';
import { useWidgetContext } from '../WidgetContext';

import { WidgetToolButton } from './WidgetToolButton';

/**
 * A widget's Filter tool. It opens the widget's "Filters" popover; with no
 * filter yet, a writer picks a property first and the new rule's editor opens
 * in the popover. The popover state is the widget's conditions context
 * (`WidgetConditionsProvider`), so the column header's "Filter" opens it too.
 * The popover never opens by itself: a collaborator's first filter must not
 * pop it up.
 */
export function WidgetFilterTool() {
  const { t } = useTranslation();
  const filters = useFiltersSelector();
  const readOnly = useConditionsReadOnly();
  const addFilter = useAddFilter();
  const conditions = useConditionsContext();
  const { editing } = useWidgetContext();
  const [pickerOpen, setPickerOpen] = useState(false);
  // The widget's filters differ from its saved view (WP07): the orange dot.
  const unsaved = Boolean(useWidgetPrivateSnapshot()?.filters);
  const active = filters.length > 0;

  return (
    <WidgetConditionsPopover
      kind='filters'
      onOpenChange={(next) => {
        conditions?.setExpanded(next);
        if (!next) conditions?.setAdvancedPanelOpen?.(false);
      }}
      open={Boolean(conditions?.expanded)}
    >
      <PropertiesMenu
        asChild
        excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
        onOpenChange={setPickerOpen}
        onSelect={(fieldId) => {
          conditions?.setOpenFilterId?.(addFilter(fieldId));
          conditions?.setExpanded(true);
        }}
        open={pickerOpen}
        searchPlaceholder={t('grid.settings.filterBy')}
      >
        <div>
          <WidgetToolButton
            accent={editing}
            badge={unsaved ? <UnsavedDot placement='tool' testId='database-actions-filter-dot' /> : null}
            className='relative'
            data-active={String(active)}
            data-unsaved={String(unsaved)}
            data-testid='database-actions-filter'
            icon={FilterIcon}
            iconClassName='h-5 w-5'
            label={t('grid.settings.filter')}
            onClick={(event) => {
              event.stopPropagation();
              // No filters (and nothing unsaved to reset): pick a property first. Otherwise toggle the popover.
              if (!readOnly && !active && !unsaved) setPickerOpen(true);
              else conditions?.toggleExpanded();
            }}
            parityId='dash-widget-tool-filter'
          />
        </div>
      </PropertiesMenu>
    </WidgetConditionsPopover>
  );
}

export default WidgetFilterTool;
