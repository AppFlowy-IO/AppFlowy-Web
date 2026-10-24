import { ComponentType, ReactNode, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  useConditionsReadOnly,
  useDatabaseContext,
  useDatabaseViewLayout,
  useFieldSelector,
  useFiltersSelector,
  useReadOnly,
  useSortsSelector,
} from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as FilterIcon } from '@/assets/icons/filter.svg';
import { ReactComponent as SortIcon } from '@/assets/icons/sort.svg';
import { BoardSettingsItems } from '@/components/database/components/settings/BoardSettings';
import { CalendarSettingsItems } from '@/components/database/components/settings/CalendarSettings';
import { ChartSettingsItems } from '@/components/database/components/settings/ChartSettings';
import { FeedSettingsItems } from '@/components/database/components/settings/FeedSettings';
import { GallerySettingsItems } from '@/components/database/components/settings/GallerySettings';
import { GridSettingsItems } from '@/components/database/components/settings/GridSettings';
import { ListSettingsItems } from '@/components/database/components/settings/ListSettings';
import { TimelineSettingsItems } from '@/components/database/components/settings/TimelineSettings';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useAddWidgetFlowState } from './add-widget/add-widget-api';
import { AddWidgetFlowState } from './add-widget/add-widget-flow';
import { DOCK_GAP, DOCK_PADDING, dockedPopoverSide, DockSide } from './add-widget/docked-popover';
import { DASHBOARD_POPOVER_RADIUS, WIDGET_SETTINGS_WIDTH } from './constants';
import { useDashboardUi } from './DashboardUiContext';
import { useWidgetSourceName } from './hooks/useWidgetSourceName';
import { WidgetOpenPagesInRow } from './settings/WidgetOpenPagesInRow';
import { WIDGET_VIEW_NAME_FIELD_ATTR, WidgetViewNameField } from './owned-views/WidgetViewNameField';
import { getLayoutLabel } from './utils';
import { getDashboardWidgetTools } from './widget-tools';
import { WidgetFiltersBody, WidgetSortsBody } from './WidgetConditionsPopover';
import { useWidgetContext } from './WidgetContext';

/** The view's own settings rows per layout (the same rows its toolbar menu shows). */
const SETTINGS_ITEMS: Partial<Record<DatabaseViewLayout, ComponentType>> = {
  [DatabaseViewLayout.Grid]: GridSettingsItems,
  [DatabaseViewLayout.Board]: BoardSettingsItems,
  [DatabaseViewLayout.Calendar]: CalendarSettingsItems,
  [DatabaseViewLayout.Chart]: ChartSettingsItems,
  [DatabaseViewLayout.List]: ListSettingsItems,
  [DatabaseViewLayout.Gallery]: GallerySettingsItems,
  [DatabaseViewLayout.Feed]: FeedSettingsItems,
  [DatabaseViewLayout.Timeline]: TimelineSettingsItems,
};

// The Settings tool's slot (`WidgetTools`), for a tool that does not attach `settingsToolRef`.
const SETTINGS_TOOL_SELECTOR = '[data-widget-tool="settings"]';
/** The host and its filter and sort submenus: 300px wide with 10px corners (`tokens.json` `geometry.popover`). */
const HOST_SIZE_STYLE = {
  width: WIDGET_SETTINGS_WIDTH,
  minWidth: WIDGET_SETTINGS_WIDTH,
  borderRadius: DASHBOARD_POPOVER_RADIUS,
};
const SUBMENU_SIZE_STYLE = { width: WIDGET_SETTINGS_WIDTH, borderRadius: DASHBOARD_POPOVER_RADIUS };

/** The trailing text of the Sort row: the single sort's property, else "N sorts". */
function SortSummary() {
  const { t } = useTranslation();
  const sorts = useSortsSelector();
  const { field } = useFieldSelector(sorts.length === 1 ? sorts[0].fieldId : '');

  if (sorts.length === 0) return null;
  return <>{sorts.length === 1 ? field?.get(YjsDatabaseKey.name) ?? '' : `${sorts.length} ${t('grid.sort.sorts')}`}</>;
}

/** A host row that opens the same rule list as the widget's filter or sort popover. */
function ConditionsRow({
  testId,
  icon,
  label,
  trailing,
  children,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  trailing: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-parity-id='dash-widget-settings-row' data-testid={testId}>
        {icon}
        <span className='flex-1 truncate' data-parity-id='dash-widget-settings-row__label'>
          {label}
        </span>
        <span
          className='ml-auto max-w-[120px] truncate text-xs text-text-secondary'
          data-parity-id='dash-widget-settings-row__value'
        >
          {trailing}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className='p-2' style={SUBMENU_SIZE_STYLE}>
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function WidgetSettingsBody() {
  const { t } = useTranslation();
  const { databaseId, viewId, settingsOpen, actions } = useWidgetContext();
  // `null` until the view's layout is read (and for a view that stores none):
  // only the Source row, which needs no layout, shows meanwhile.
  const layout = useDatabaseViewLayout();
  const readOnly = useReadOnly();
  const conditionsReadOnly = useConditionsReadOnly();
  const filters = useFiltersSelector();
  const sourceName = useWidgetSourceName(databaseId, settingsOpen);
  const Items = layout === null ? undefined : SETTINGS_ITEMS[layout];
  const editTools =
    layout === null
      ? []
      : getDashboardWidgetTools({
          layout,
          editing: true,
          canWrite: !readOnly,
          canEditConditions: !conditionsReadOnly,
        });

  return (
    // 3px + the menu's 1px border: the rows sit 4px inside the host, as on desktop.
    <div className='p-[3px]'>
      <DropdownMenuGroup>
        {Items ? <Items /> : null}
        {editTools.includes('filter') ? (
          <ConditionsRow
            icon={<FilterIcon aria-hidden='true' />}
            label={t('grid.settings.filter')}
            testId='dashboard-widget-settings-filter'
            trailing={filters.length > 0 ? filters.length : null}
          >
            <WidgetFiltersBody />
          </ConditionsRow>
        ) : null}
        {editTools.includes('sort') ? (
          <ConditionsRow
            icon={<SortIcon aria-hidden='true' />}
            label={t('grid.settings.sort')}
            testId='dashboard-widget-settings-sort'
            trailing={<SortSummary />}
          >
            {/* Deleting every sort leaves the row; the submenu then shows the empty list. */}
            <WidgetSortsBody onClose={() => undefined} />
          </ConditionsRow>
        ) : null}
        {/* How the widget opens its records (WP13 §3.8); not for charts. */}
        <WidgetOpenPagesInRow layout={layout} viewId={viewId} />
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-parity-id='dash-widget-settings-row'
        data-testid='dashboard-widget-settings-source'
        onSelect={() => actions.changeView()}
      >
        <DatabaseIcon aria-hidden='true' />
        <span className='flex-1 truncate' data-parity-id='dash-widget-settings-row__label'>
          {t('dashboard.widget.source', { defaultValue: 'Source' })}
        </span>
        {sourceName ? (
          <span
            className='ml-auto max-w-[120px] truncate text-xs text-text-secondary'
            data-parity-id='dash-widget-settings-row__value'
          >
            {sourceName}
          </span>
        ) : null}
        {/* "Source ›": the chevron the submenu rows get from DropdownMenuSubTrigger. */}
        <ChevronRightIcon
          aria-hidden='true'
          className='!h-4 !w-4 text-icon-tertiary'
          data-parity-id='dash-widget-settings-row__chevron'
        />
      </DropdownMenuItem>
    </div>
  );
}

/** The widget's name, which is its view's name (WP05): renames the view. */
function WidgetSettingsNameField() {
  const { t } = useTranslation();
  const { widgetId, name, layout } = useWidgetContext();
  const { ownedViews } = useDashboardUi();
  // The widget's own database: the doc a rename of another database's view writes.
  const { databaseDoc } = useDatabaseContext();
  const readOnly = useReadOnly();
  const label = getLayoutLabel(layout);

  return (
    <WidgetViewNameField
      disabled={readOnly}
      onCommit={(next) => ownedViews.renameWidgetView(widgetId, next, { name, doc: databaseDoc })}
      placeholder={t(label.key, { defaultValue: label.defaultValue })}
      value={name}
    />
  );
}

const isFlowSettingsOf = (widgetId: string) => (state: AddWidgetFlowState) =>
  state.kind === 'settings' && state.widgetId === widgetId;

/**
 * The settings host of a dashboard widget ("View settings"), opened by the
 * Edit-mode settings tool, "Edit view" or the add flow's "Edit chart". 300px
 * wide and capped at 560px with scrolling; docked to the widget box's
 * top-right corner like the add flow's panels (WP06 §1.6): on its right when
 * there is room, else on its left, overlapping the widget. A dropdown menu, so
 * the view's existing settings rows and their submenus work unchanged; its
 * trigger is a zero-size span portaled into the widget box's corner, so React
 * context (the widget's database) is kept.
 *
 * The header holds the widget name (WP05), and a back button when the add
 * flow's New view panel opened it.
 */
export function WidgetSettingsHost({ nameField }: { nameField?: ReactNode }) {
  const { t } = useTranslation();
  const { widgetId, editing, settingsOpen, setSettingsOpen, getBoxElement, settingsToolRef } = useWidgetContext();
  const { addWidget } = useDashboardUi();
  const fromFlow = useAddWidgetFlowState(addWidget.flow, isFlowSettingsOf(widgetId));
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<DockSide>('right');

  // The box is an ancestor: its ref is attached once this commit's effects run.
  useEffect(() => setBox(getBoxElement()), [getBoxElement]);

  // The dock side, decided when the host opens.
  useEffect(() => {
    if (!settingsOpen || !box) return;
    setSide(dockedPopoverSide(box.getBoundingClientRect().right, window.innerWidth));
  }, [box, settingsOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setSettingsOpen(open);
      // Closing the host the flow opened ends the flow (the widget stays).
      if (!open && addWidget.flow.getState().kind === 'settings') addWidget.flow.dispatch({ type: 'dismiss' });
    },
    [addWidget, setSettingsOpen]
  );

  if (!editing || !box) return null;
  // The tool that toggles the host: the widget's ref, else the tool in its slot of the box.
  const getSettingsTool = () =>
    settingsToolRef.current ?? box.querySelector<HTMLElement>(`${SETTINGS_TOOL_SELECTOR} button`);

  return (
    <DropdownMenu modal={false} onOpenChange={handleOpenChange} open={settingsOpen}>
      {createPortal(
        <DropdownMenuTrigger asChild>
          <span aria-hidden='true' className='pointer-events-none absolute right-0 top-0 h-0 w-0' tabIndex={-1} />
        </DropdownMenuTrigger>,
        box
      )}
      {settingsOpen ? (
        <DropdownMenuContent
          align='start'
          // As on desktop: 8px between the parts of a row, 16px submenu chevrons, and a
          // row's trailing value is secondary text beside its chevron (both have `ml-auto`
          // in the shared rows, which would leave the value in the middle of this wider menu).
          className='max-h-[560px] overflow-y-auto bg-surface-primary p-0 [&_[data-slot=dropdown-menu-sub-trigger]>.ml-auto+svg]:!ml-0 [&_[data-slot=dropdown-menu-sub-trigger]>svg:last-child]:!h-4 [&_[data-slot=dropdown-menu-sub-trigger]>svg:last-child]:!w-4 [&_[role=menuitem]>.ml-auto]:!text-text-secondary [&_[role=menuitem]]:!gap-2'
          collisionPadding={DOCK_PADDING}
          data-parity-id='dash-widget-settings'
          data-side={side}
          data-testid='dashboard-widget-settings'
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A panel the host handed over to (Settings › Source docks in its place) may already hold the
            // focus: taking it back to the tool would count as a focus outside that panel and close it.
            const active = document.activeElement;

            if (active && active !== document.body && active.isConnected) return;
            getSettingsTool()?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // The first Escape in the name field only reverts the name.
            if ((document.activeElement as HTMLElement | null)?.hasAttribute(WIDGET_VIEW_NAME_FIELD_ATTR)) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            // The settings tool toggles the host itself.
            if (getSettingsTool()?.contains(event.target as Node | null)) event.preventDefault();
          }}
          side={side}
          sideOffset={DOCK_GAP}
          style={HOST_SIZE_STYLE}
        >
          <div className='flex items-center gap-2 px-3 pb-1 pt-3'>
            {fromFlow ? (
              <Button
                aria-label={t('dashboard.picker.back', { defaultValue: 'Back' })}
                className='-ml-1 text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'
                data-testid='dashboard-widget-settings-back'
                onClick={() => {
                  setSettingsOpen(false);
                  addWidget.flow.dispatch({ type: 'back' });
                }}
                size='icon-sm'
                type='button'
                variant='ghost'
              >
                <BackIcon aria-hidden='true' />
              </Button>
            ) : null}
            <span
              className='flex-1 truncate text-sm font-semibold leading-5 text-text-primary'
              data-parity-id='dash-widget-settings__title'
            >
              {t('dashboard.widget.viewSettings', { defaultValue: 'View settings' })}
            </span>
            <Button
              aria-label={t('dashboard.widget.close', { defaultValue: 'Close' })}
              className='!rounded-full text-icon-secondary [&_svg]:h-4 [&_svg]:w-4'
              data-parity-id='dash-widget-settings-close'
              data-testid='dashboard-widget-settings-close'
              onClick={() => handleOpenChange(false)}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <CloseIcon aria-hidden='true' />
            </Button>
          </div>
          <div className='px-3 pb-1'>{nameField ?? <WidgetSettingsNameField />}</div>
          <WidgetSettingsBody />
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

export default WidgetSettingsHost;
