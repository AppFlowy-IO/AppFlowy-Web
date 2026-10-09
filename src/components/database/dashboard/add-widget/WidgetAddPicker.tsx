import { KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DatabaseViewLayout } from '@/application/types';
import { ONLINE_DASHBOARD_VIEW_CREATION_REQUIRED } from '@/application/view-online-policy';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { cn } from '@/lib/utils';

import { useDashboardContext } from '../DashboardContext';
import { useDashboardUi } from '../DashboardUiContext';
import { useDashboardCreationOnline } from '../hooks/useDashboardCreationOnline';

import { AddWidgetFlowState } from './add-widget-flow';
import { DockPanelHeader } from './DockPanelHeader';
import { NEW_VIEW_LAYOUTS, WidgetPickerSections } from './picker-sections';
import { useWidgetPickerSections } from './useWidgetPickerSections';
import { LAYOUT_ROW_PARITY_SLUGS, movePickerFocus, WidgetSourceList } from './WidgetSourceList';

type PickerFlowState = Extract<AddWidgetFlowState, { kind: 'creating' | 'choosing_existing' | 'open' }>;

/** The first selectable row of the sections, in visual order (Enter in the search). */
function firstPick(
  sections: WidgetPickerSections
): { kind: 'existing'; viewId: string; databaseId: string } | { kind: 'layout'; layout: DatabaseViewLayout } | null {
  const option =
    sections.host?.options[0] ?? sections.other.groups.find((group) => group.options.length > 0)?.options[0];

  if (option) return { kind: 'existing', viewId: option.viewId, databaseId: option.databaseId };
  const row = sections.newView.find((candidate) => !candidate.disabled);

  return row ? { kind: 'layout', layout: row.layout } : null;
}

/** The search field of a docked picker: 28 tall, radius 6, accent focus ring. */
export function PickerSearchField({
  value,
  onChange,
  onKeyDown,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  return (
    <label
      className={cn(
        'mx-1 mb-1 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-border-primary px-2',
        'focus-within:border-dash-accent focus-within:ring-1 focus-within:ring-dash-accent'
      )}
      data-parity-id='dash-widget-picker-search'
    >
      <SearchIcon
        aria-hidden='true'
        className='h-4 w-4 shrink-0 text-icon-tertiary'
        data-parity-id='dash-widget-picker-search__icon'
      />
      <input
        autoFocus
        className='min-w-0 flex-1 bg-transparent text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary'
        data-dock-autofocus='true'
        data-testid='dashboard-widget-picker-search'
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

interface WidgetAddPickerProps {
  state: PickerFlowState;
}

/**
 * The "New view" picker docked beside a widget the add flow inserted (WP06
 * §1.4): back and close, a search field (focused and typable at once), then
 * the views of the dashboard's database, Other data sources and the New view
 * types. Its rows stay disabled until the widget's default view exists.
 * "New view in {database}" opens that database's type list.
 */
export function WidgetAddPicker({ state }: WidgetAddPickerProps) {
  const { t } = useTranslation();
  const { hostDatabaseId } = useDashboardContext();
  const { addWidget } = useDashboardUi();
  const { flow } = addWidget;
  const creating = state.kind === 'creating';
  const online = useDashboardCreationOnline();
  const existingOnly = state.kind === 'choosing_existing' || !online;
  const excludeViewIds = useMemo(() => (state.kind === 'open' ? [state.viewId] : []), [state]);
  const picker = useWidgetPickerSections({ mode: 'add', primaryDatabaseId: hostDatabaseId, excludeViewIds, existingOnly });
  const [target, setTarget] = useState<{ databaseId: string; name: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pickExisting = useCallback(
    (viewId: string, databaseId: string) => flow.dispatch({ type: 'pick_existing', viewId, databaseId }),
    [flow]
  );
  const pickLayout = useCallback(
    (layout: DatabaseViewLayout) => {
      flow.dispatch({ type: 'pick_layout', layout });
    },
    [flow]
  );
  const newInDatabase = useCallback((databaseId: string, name: string) => setTarget({ databaseId, name }), []);
  const close = useCallback(() => flow.dispatch({ type: 'dismiss' }), [flow]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePickerFocus(listRef.current, null, 1);
      return;
    }

    if (event.key !== 'Enter' || creating) return;
    // Enter may beat the deferred list: pick from what the field says.
    const pick = firstPick(picker.sectionsFor(picker.query));

    if (!pick) return;
    event.preventDefault();
    if (pick.kind === 'existing') pickExisting(pick.viewId, pick.databaseId);
    else pickLayout(pick.layout);
  };

  if (target && !existingOnly) {
    return (
      <div className='flex min-h-0 flex-1 flex-col' data-testid='dashboard-widget-picker-new-in-database-page'>
        <DockPanelHeader
          onBack={() => setTarget(null)}
          onClose={close}
          testIdPrefix='dashboard-widget-picker'
          title={t('dashboard.picker.newViewIn', {
            database: target.name || t('untitled'),
            defaultValue: 'New view in {{database}}',
          })}
        />
        <div
          className='flex flex-col'
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            movePickerFocus(event.currentTarget, document.activeElement, event.key === 'ArrowDown' ? 1 : -1);
          }}
        >
          {NEW_VIEW_LAYOUTS.filter(
            (layout) =>
              layout !== DatabaseViewLayout.Timeline || picker.sections.newView.some((row) => row.layout === layout)
          ).map((layout) => {
            const disabled =
              creating ||
              picker.sections.newView.find((row) => row.layout === layout)?.disabled === true ||
              (layout === DatabaseViewLayout.Chart && Boolean(picker.chartDisabledReason));
            const anchorViewId = picker.anchorViewOf(target.databaseId);

            return (
              <button
                aria-disabled={disabled || !anchorViewId || undefined}
                className='flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-dash-hover-fill focus-visible:bg-dash-hover-fill aria-disabled:opacity-60'
                data-database-id={target.databaseId}
                data-layout={String(layout)}
                data-parity-id={`dash-widget-picker-layout-${LAYOUT_ROW_PARITY_SLUGS[layout] ?? 'grid'}`}
                data-picker-focusable='true'
                data-testid='dashboard-widget-picker-layout-option'
                key={layout}
                onClick={() => {
                  if (disabled || !anchorViewId) return;
                  addWidget.createInDatabase(target.databaseId, anchorViewId, layout);
                }}
                type='button'
              >
                <span className='truncate'>{picker.layoutLabel(layout)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <DockPanelHeader
        onBack={() => flow.dispatch({ type: 'back' })}
        onClose={close}
        parityPrefix='dash-widget-picker'
        testIdPrefix='dashboard-widget-picker'
        title={existingOnly
          ? t('dashboard.picker.chooseExisting', { defaultValue: 'Choose an existing view' })
          : t('dashboard.picker.newView', { defaultValue: 'New view' })}
      />
      <PickerSearchField
        onChange={picker.setQuery}
        onKeyDown={handleSearchKeyDown}
        placeholder={t('dashboard.picker.searchPlaceholder', { defaultValue: 'Search for a view...' })}
        value={picker.query}
      />
      {existingOnly ? (
        <p className='px-2 py-1 text-xs text-text-secondary' role='status'>
          {t('databaseViewCreation.dashboardOnlineRequired', { defaultValue: ONLINE_DASHBOARD_VIEW_CREATION_REQUIRED })}
        </p>
      ) : null}
      <WidgetSourceList
        disabled={creating}
        list={picker.list}
        listRef={listRef}
        mode='add'
        onNewInDatabase={newInDatabase}
        onPickExisting={pickExisting}
        onPickLayout={pickLayout}
      />
    </div>
  );
}

export default WidgetAddPicker;
