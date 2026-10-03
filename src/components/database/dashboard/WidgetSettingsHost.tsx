import { ComponentType, ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  useConditionsReadOnly,
  useDatabaseViewLayout,
  useFieldSelector,
  useFiltersSelector,
  useReadOnly,
  useSortsSelector,
} from '@/application/database-yjs';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
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

import { DASHBOARD_POPOVER_RADIUS, WIDGET_SETTINGS_WIDTH } from './constants';
import { useWidgetSourceName } from './hooks/useWidgetSourceName';
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
  const { databaseId, settingsOpen, actions } = useWidgetContext();
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

/**
 * The settings host of a dashboard widget ("View settings"), opened by the
 * Edit-mode settings tool. 300px wide, anchored to the right of the widget
 * box and top-aligned (it flips left when there is no room), capped at 560px
 * with scrolling. A dropdown menu, so the view's existing settings rows and
 * their submenus work unchanged; its trigger is a span portaled into the
 * widget box, so React context (the widget's database) is kept. The span
 * covers the box without taking pointer events: the menu is placed against
 * the whole box, so it flips to the box's left side (as desktop's
 * `flipToFit`) instead of over the widget.
 *
 * `nameField` is the header slot for the widget name (WP05).
 */
export function WidgetSettingsHost({ nameField }: { nameField?: ReactNode }) {
  const { t } = useTranslation();
  const { editing, settingsOpen, setSettingsOpen, getBoxElement, settingsToolRef } = useWidgetContext();
  const [box, setBox] = useState<HTMLElement | null>(null);

  // The box is an ancestor: its ref is attached once this commit's effects run.
  useEffect(() => setBox(getBoxElement()), [getBoxElement]);

  if (!editing || !box) return null;
  // The tool that toggles the host: the widget's ref, else the tool in its slot of the box.
  const getSettingsTool = () =>
    settingsToolRef.current ?? box.querySelector<HTMLElement>(`${SETTINGS_TOOL_SELECTOR} button`);

  return (
    <DropdownMenu modal={false} onOpenChange={setSettingsOpen} open={settingsOpen}>
      {createPortal(
        <DropdownMenuTrigger asChild>
          <span aria-hidden='true' className='pointer-events-none absolute inset-0' tabIndex={-1} />
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
          collisionPadding={16}
          data-parity-id='dash-widget-settings'
          data-testid='dashboard-widget-settings'
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            getSettingsTool()?.focus();
          }}
          onInteractOutside={(event) => {
            // The settings tool toggles the host itself.
            if (getSettingsTool()?.contains(event.target as Node | null)) event.preventDefault();
          }}
          side='right'
          sideOffset={8}
          style={HOST_SIZE_STYLE}
        >
          <div className='flex items-center gap-2 px-3 pb-1 pt-3'>
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
              onClick={() => setSettingsOpen(false)}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <CloseIcon aria-hidden='true' />
            </Button>
          </div>
          {nameField ? <div className='px-3 pb-1'>{nameField}</div> : null}
          <WidgetSettingsBody />
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

export default WidgetSettingsHost;
