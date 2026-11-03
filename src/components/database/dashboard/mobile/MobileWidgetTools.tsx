import { useTranslation } from 'react-i18next';

import {
  useConditionsReadOnly,
  useDatabaseViewLayout,
  useFiltersSelector,
  useReadOnly,
} from '@/application/database-yjs';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import { cn } from '@/lib/utils';

import { UnsavedDot } from '../private/UnsavedDot';
import { useWidgetPrivateSnapshot } from '../private/WidgetPrivateContext';
import { WidgetToolButton } from '../widget-tool-buttons/WidgetToolButton';
import { getDashboardWidgetTools, WIDGET_TOOL_SLOT_CLASS, WIDGET_TOOLS_CONTAINER_CLASS } from '../widget-tools';
import { WidgetFiltersPanel } from '../WidgetConditionsPopover';
import { useWidgetContext } from '../WidgetContext';

import { MOBILE_TOOL_HIT_AREA_CLASS } from './constants';
import { DashboardSurface } from './DashboardSurface';

/**
 * The phone's Filter tool: the widget's filter panel (rules, "Add filter",
 * the private footer) in a "Filter" bottom sheet. The sheet is the widget's
 * conditions panel (`expanded`), so a column header's "Filter" opens it too.
 * Without a rule (and nothing unsaved to reset) it starts on the property
 * picker of "Add filter".
 */
function MobileFilterTool() {
  const { t } = useTranslation();
  const filters = useFiltersSelector();
  const readOnly = useConditionsReadOnly();
  const conditions = useConditionsContext();
  // The widget's filters differ from its saved view (WP07): the orange dot.
  const unsaved = Boolean(useWidgetPrivateSnapshot()?.filters);
  const active = filters.length > 0;
  const label = t('grid.settings.filter');

  return (
    <DashboardSurface
      mobile
      onOpenChange={(next) => {
        conditions?.setExpanded(next);
        if (!next) conditions?.setAdvancedPanelOpen?.(false);
      }}
      open={Boolean(conditions?.expanded)}
      sheet={{ sheet: 'widget-filter', title: label }}
      trigger={
        <WidgetToolButton
          badge={unsaved ? <UnsavedDot placement='tool' testId='database-actions-filter-dot' /> : null}
          className={MOBILE_TOOL_HIT_AREA_CLASS}
          data-active={String(active)}
          data-testid='database-actions-filter'
          data-unsaved={String(unsaved)}
          icon={FilterIcon}
          iconClassName='h-5 w-5'
          label={label}
          onClick={(event) => event.stopPropagation()}
          parityId='dash-widget-tool-filter'
        />
      }
    >
      <WidgetFiltersPanel landOnPicker={!readOnly && !active && !unsaved} />
    </DashboardSurface>
  );
}

/** The phone's Search tool: it expands the search field over the widget title (WP14 §1.4.5). */
function MobileSearchTool() {
  const { t } = useTranslation();
  const { setSearchActive } = useWidgetContext();

  return (
    <WidgetToolButton
      className={MOBILE_TOOL_HIT_AREA_CLASS}
      data-testid='database-actions-search'
      icon={SearchIcon}
      label={t('search.label')}
      onClick={(event) => {
        event.stopPropagation();
        setSearchActive(true);
      }}
      parityId='dash-widget-tool-search'
    />
  );
}

/**
 * A widget header's tools in a mobile context (WP14 §1.4.4): Search, then
 * Filter at the far right, always visible (touch has no hover). Search goes
 * away while its field is expanded over the title. Readers get the same
 * tools: their filters and searches are their own.
 */
export function MobileWidgetTools() {
  const { searchActive } = useWidgetContext();
  const layout = useDatabaseViewLayout();
  const readOnly = useReadOnly();
  const conditionsReadOnly = useConditionsReadOnly();
  const filters = useFiltersSelector();
  const privateParts = useWidgetPrivateSnapshot();

  // The layout is read from the view after the first render.
  if (layout === null) return null;

  const tools = getDashboardWidgetTools({
    layout,
    editing: false,
    canWrite: !readOnly,
    canEditConditions: !conditionsReadOnly,
    mobile: true,
  }).filter((tool) => !(tool === 'search' && searchActive));
  const filterActive = filters.length > 0 || Boolean(privateParts?.filters);

  if (tools.length === 0) return null;

  return (
    <div
      className={cn('group/tools flex items-center gap-4', WIDGET_TOOLS_CONTAINER_CLASS)}
      data-dashboard-widget='true'
      data-force-visible='true'
      data-has-active={filterActive && tools.includes('filter') ? 'true' : 'false'}
      data-mobile='true'
      data-parity-id='dash-widget-tools'
      data-testid='database-actions'
    >
      {tools.map((tool) => (
        <div
          className={WIDGET_TOOL_SLOT_CLASS}
          data-active={tool === 'filter' && filterActive ? 'true' : 'false'}
          data-widget-tool={tool}
          key={tool}
        >
          {tool === 'search' ? <MobileSearchTool /> : <MobileFilterTool />}
        </div>
      ))}
    </div>
  );
}

export default MobileWidgetTools;
