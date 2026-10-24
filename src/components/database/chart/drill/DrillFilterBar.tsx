import { ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useAdvancedFiltersSelector,
  useConditionsReadOnly,
  useDatabase,
  useDatabaseContext,
  useFiltersSelector,
} from '@/application/database-yjs';
import type { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { useAddAdvancedFilterAndRebuild, useAddFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { DrillCategoryChip } from '@/application/database-yjs/drill-query';
import { YDoc, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DashboardIcon } from '@/assets/icons/dashboard.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { DatabaseConditionsContext, useConditionsContext } from '@/components/database/components/conditions/context';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { AdvancedFiltersBadge } from '@/components/database/components/filters/advanced';
import Filter from '@/components/database/components/filters/Filter';
import { FILTER_EXCLUDED_FIELD_TYPES } from '@/components/database/components/filters/filter-field-types';
import { useDashboardFiltersOptional } from '@/components/database/dashboard/DashboardContext';
import {
  getGlobalFilterPillLabel,
  isGlobalFilterActive,
} from '@/components/database/dashboard/global-filters/global-filter.conditions';
import { mergedSelectedNames } from '@/components/database/dashboard/global-filters/global-filter.options';
import {
  GlobalFilterSource,
  usesOptionContent,
} from '@/components/database/dashboard/global-filters/global-filter.utils';
import {
  useGlobalFilterDateFormat,
  useGlobalFilterPeople,
} from '@/components/database/dashboard/global-filters/useGlobalFilterLabel';
import { useGlobalFilterSources } from '@/components/database/dashboard/global-filters/useGlobalFilterSources';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DRILL, DRILL_CHIPS_STYLE, DRILL_PILL_STYLE } from './drillStyles';

/** A read-only pill: a global filter, the category, the sub-group or the rows fallback. No chevron. */
function DrillPill({
  kind,
  icon,
  text,
  tooltip,
}: {
  kind: 'global' | DrillCategoryChip['kind'];
  icon?: ReactNode;
  text: string;
  tooltip?: string;
}) {
  const pill = (
    <span
      aria-readonly='true'
      className={cn(
        'inline-flex max-w-[300px] cursor-default items-center gap-1 px-2',
        'bg-dash-pill-bg-active text-dash-pill-fg-active [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0'
      )}
      data-chip-kind={kind}
      data-parity-id='dash-drilldown-chip'
      data-testid='drill-chip'
      style={DRILL_PILL_STYLE}
      tabIndex={tooltip ? 0 : undefined}
    >
      {icon}
      <span className='truncate' data-testid='drill-chip-text'>
        {text}
      </span>
    </span>
  );

  if (!tooltip) return pill;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side='bottom'>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** One resolved global filter of this database, live: `getGlobalFilterPillLabel` with this database's property. */
function DrillGlobalChip({ filter, sources }: { filter: DashboardGlobalFilter; sources: GlobalFilterSource[] }) {
  const { t } = useTranslation();
  const dateFormat = useGlobalFilterDateFormat();
  const people = useGlobalFilterPeople(filter);
  const databaseId = sources[0]?.databaseId;
  const targetField = sources[0]?.fields.find((field) => field.id === filter.targets[databaseId ?? '']);
  const text = getGlobalFilterPillLabel(filter, {
    active: isGlobalFilterActive(filter, sources),
    primaryFieldName: targetField?.type === filter.fieldType ? targetField.name : undefined,
    typeName: getFieldTypeName(filter.fieldType, t),
    mergedNames: usesOptionContent(filter.fieldType) ? mergedSelectedNames(filter, sources) : undefined,
    people,
    dateFormat,
    t,
  });

  return (
    <DrillPill
      icon={<DashboardIcon aria-hidden='true' />}
      kind='global'
      text={text}
      tooltip={t('chart.drilldown.fromDashboardFilter', { defaultValue: 'From dashboard filter' })}
    />
  );
}

const NO_FILTERS: DashboardGlobalFilter[] = [];
const NO_SOURCE_NAMES: Record<string, string> = {};

/** The dashboard's global filters that reach this database (`effectiveGlobalFilters`, live). */
function DrillGlobalChips({ databaseId, databaseDoc }: { databaseId: string; databaseDoc: YDoc }) {
  const dashboardFilters = useDashboardFiltersOptional();
  const effective = dashboardFilters?.effectiveGlobalFilters ?? NO_FILTERS;
  const filters = useMemo(
    () => (databaseId ? effective.filter((filter) => Boolean(filter.targets[databaseId])) : NO_FILTERS),
    [effective, databaseId]
  );
  const sourceDocs = useMemo(() => ({ [databaseId]: databaseDoc }), [databaseId, databaseDoc]);
  const databaseIds = useMemo(() => [databaseId], [databaseId]);
  const sources = useGlobalFilterSources(sourceDocs, NO_SOURCE_NAMES, { databaseIds });

  return (
    <>
      {filters.map((filter) => (
        <DrillGlobalChip filter={filter} key={filter.id} sources={sources} />
      ))}
    </>
  );
}

/** The drill session's own filters (the widget's, then drill-local ones): editable pill chips. */
function DrillFilterChips() {
  const filters = useFiltersSelector();
  const advancedFilters = useAdvancedFiltersSelector();

  if (advancedFilters.length > 0) {
    return (
      <span
        className='inline-flex [&_[data-testid=advanced-filters-badge]]:h-6 [&_[data-testid=advanced-filters-badge]]:border-0 [&_[data-testid=advanced-filters-badge]]:bg-dash-pill-bg-active'
        data-chip-kind='filter'
        data-testid='drill-chip'
      >
        <AdvancedFiltersBadge count={advancedFilters.length} />
      </span>
    );
  }

  return (
    <>
      {filters.map((filter) => (
        <span className='inline-flex' data-chip-kind='filter' data-testid='drill-chip' key={filter.id}>
          <Filter filterId={filter.id} parityId='dash-drilldown-chip' variant='pill' />
        </span>
      ))}
    </>
  );
}

/** `+ Filter`: the property picker, adding a drill-local filter and opening its editor. */
function DrillAddFilter() {
  const { t } = useTranslation();
  const readOnly = useConditionsReadOnly();
  const addFilter = useAddFilter();
  const addAdvancedFilter = useAddAdvancedFilterAndRebuild();
  const advancedFilters = useAdvancedFiltersSelector();
  const [open, setOpen] = useState(false);
  const conditions = useConditionsContext();
  const setOpenFilterId = conditions?.setOpenFilterId;
  const setAdvancedPanelOpen = conditions?.setAdvancedPanelOpen;
  const onSelect = useCallback(
    (fieldId: string) => {
      if (advancedFilters.length > 0) {
        addAdvancedFilter(fieldId);
        setAdvancedPanelOpen?.(true);
        return;
      }

      setOpenFilterId?.(addFilter(fieldId));
    },
    [addAdvancedFilter, addFilter, advancedFilters.length, setAdvancedPanelOpen, setOpenFilterId]
  );

  if (readOnly) return null;
  return (
    <PropertiesMenu
      asChild
      excludedTypes={FILTER_EXCLUDED_FIELD_TYPES}
      onOpenChange={setOpen}
      onSelect={onSelect}
      open={open}
      searchPlaceholder={t('grid.settings.filterBy')}
    >
      <button
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-200 px-2 text-text-secondary',
          'hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
          '[&_svg]:h-3.5 [&_svg]:w-3.5'
        )}
        data-testid='drill-add-filter'
        style={{ ...DRILL_PILL_STYLE, borderRadius: undefined }}
        type='button'
      >
        <PlusIcon aria-hidden='true' />
        {t('grid.settings.filter', { defaultValue: 'Filter' })}
      </button>
    </PropertiesMenu>
  );
}

// The drill's own "which chip editor is open" state, apart from the widget's
// (a chip editor of the widget must not open from the drill, and back).
function DrillConditionsProvider({ children }: { children: ReactNode }) {
  const [openFilterId, setOpenFilterId] = useState<string | undefined>();
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const value = useMemo(
    () => ({
      expanded: true,
      toggleExpanded: () => undefined,
      setExpanded: () => undefined,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode: false,
      setAdvancedMode: () => undefined,
      advancedPanelOpen,
      setAdvancedPanelOpen,
    }),
    [openFilterId, advancedPanelOpen]
  );

  return <DatabaseConditionsContext.Provider value={value}>{children}</DatabaseConditionsContext.Provider>;
}

/**
 * The chips row (WP13 §3.4), one wrapping row with 6px gaps: the drill
 * session's filters as editable pills (`showDrillFilters`, inside the drill
 * providers), the dashboard filters as read-only pills, the category and
 * sub-group pills (or "Selected rows (N)"), then `+ Filter`.
 */
export function DrillFilterBar({
  chips,
  showDrillFilters,
  variant,
}: {
  chips: DrillCategoryChip[];
  showDrillFilters: boolean;
  variant: 'dialog' | 'sheet';
}) {
  const database = useDatabase();
  const { databaseDoc } = useDatabaseContext();
  const databaseId = String(database?.get(YjsDatabaseKey.id) ?? '');

  return (
    <DrillConditionsProvider>
      <div
        className='flex shrink-0 flex-wrap items-center gap-1.5'
        data-testid='drill-filter-bar'
        style={variant === 'dialog' ? DRILL_CHIPS_STYLE : { minHeight: DRILL.chipHeight }}
      >
        {showDrillFilters ? <DrillFilterChips /> : null}
        {databaseId ? <DrillGlobalChips databaseDoc={databaseDoc} databaseId={databaseId} /> : null}
        {chips.map((chip) => (
          <DrillPill
            icon={chip.fieldId ? <FieldCustomIcon fieldId={chip.fieldId} /> : undefined}
            key={`${chip.kind}:${chip.text}`}
            kind={chip.kind}
            text={chip.text}
          />
        ))}
        {showDrillFilters ? <DrillAddFilter /> : null}
      </div>
    </DrillConditionsProvider>
  );
}
