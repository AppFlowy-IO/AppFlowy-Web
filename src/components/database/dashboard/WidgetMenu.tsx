import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ComponentType, Fragment, ReactNode, SVGProps, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as ArrowLeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as ArrowRightIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as ViewDataSourceIcon } from '@/assets/icons/arrow_up_right.svg';
import { ReactComponent as EditViewIcon } from '@/assets/icons/controller.svg';
import { ReactComponent as MoveToRowIcon } from '@/assets/icons/dashboard_move_to_row.svg';
import { ReactComponent as RowAboveIcon } from '@/assets/icons/dashboard_row_above.svg';
import { ReactComponent as RowBelowIcon } from '@/assets/icons/dashboard_row_below.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/database-template/duplicate.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useDashboardLayout } from './DashboardContext';
import { dashboardFullAnnouncement, DashboardFullTooltipContent } from './DashboardFullTooltip';
import { useDashboardUi, useDashboardUiOptional } from './DashboardUiContext';
import { WidgetMenuSheet } from './mobile/WidgetMenuSheet';
import {
  buildWidgetMenuEntries,
  canDuplicateWidget,
  getWidgetMoveTargets,
  WidgetMenuEntry,
  WidgetMenuEntryId,
} from './widget-moves';
import { useWidgetContext, useWidgetContextOptional, WidgetActions } from './WidgetContext';

// The menu model is shared with desktop and the parity fixture; the menu renders it.
export { buildWidgetMenuEntries } from './widget-moves';
export type { WidgetMenuEntry, WidgetMenuEntryId } from './widget-moves';

const ENTRY_LABELS: Record<WidgetMenuEntryId, { key: string; defaultValue: string }> = {
  'view-data-source': { key: 'dashboard.widget.viewDataSource', defaultValue: 'View data source' },
  'edit-view': { key: 'dashboard.widget.editView', defaultValue: 'Edit view' },
  'move-left': { key: 'dashboard.widget.moveLeft', defaultValue: 'Move left' },
  'move-right': { key: 'dashboard.widget.moveRight', defaultValue: 'Move right' },
  'move-to-row': { key: 'dashboard.widget.moveToRow', defaultValue: 'Move to row' },
  'create-row-above': { key: 'dashboard.widget.createRowAbove', defaultValue: 'Create new row above' },
  'create-row-below': { key: 'dashboard.widget.createRowBelow', defaultValue: 'Create new row below' },
  duplicate: { key: 'dashboard.widget.duplicate', defaultValue: 'Duplicate' },
  delete: { key: 'dashboard.widget.delete', defaultValue: 'Delete' },
};

const ENTRY_ICONS: Record<WidgetMenuEntryId, ComponentType<SVGProps<SVGSVGElement>>> = {
  'view-data-source': ViewDataSourceIcon,
  'edit-view': EditViewIcon,
  'move-left': ArrowLeftIcon,
  'move-right': ArrowRightIcon,
  'move-to-row': MoveToRowIcon,
  'create-row-above': RowAboveIcon,
  'create-row-below': RowBelowIcon,
  duplicate: DuplicateIcon,
  delete: DeleteIcon,
};

/**
 * Visual parity ids (`dashboard-parity/visual-metrics.json`), as string
 * literals: the entries are data, so the ids come from this map.
 */
const ENTRY_PARITY_IDS: Record<WidgetMenuEntryId, { item: string; icon: string; label: string }> = {
  'view-data-source': {
    item: 'dash-widget-menu-item-view-data-source',
    icon: 'dash-widget-menu-item-view-data-source__icon',
    label: 'dash-widget-menu-item-view-data-source__label',
  },
  'edit-view': {
    item: 'dash-widget-menu-item-edit-view',
    icon: 'dash-widget-menu-item-edit-view__icon',
    label: 'dash-widget-menu-item-edit-view__label',
  },
  'move-left': {
    item: 'dash-widget-menu-item-move-left',
    icon: 'dash-widget-menu-item-move-left__icon',
    label: 'dash-widget-menu-item-move-left__label',
  },
  'move-right': {
    item: 'dash-widget-menu-item-move-right',
    icon: 'dash-widget-menu-item-move-right__icon',
    label: 'dash-widget-menu-item-move-right__label',
  },
  'move-to-row': {
    item: 'dash-widget-menu-item-move-to-row',
    icon: 'dash-widget-menu-item-move-to-row__icon',
    label: 'dash-widget-menu-item-move-to-row__label',
  },
  'create-row-above': {
    item: 'dash-widget-menu-item-row-above',
    icon: 'dash-widget-menu-item-row-above__icon',
    label: 'dash-widget-menu-item-row-above__label',
  },
  'create-row-below': {
    item: 'dash-widget-menu-item-row-below',
    icon: 'dash-widget-menu-item-row-below__icon',
    label: 'dash-widget-menu-item-row-below__label',
  },
  duplicate: {
    item: 'dash-widget-menu-item-duplicate',
    icon: 'dash-widget-menu-item-duplicate__icon',
    label: 'dash-widget-menu-item-duplicate__label',
  },
  delete: {
    item: 'dash-widget-menu-item-delete',
    icon: 'dash-widget-menu-item-delete__icon',
    label: 'dash-widget-menu-item-delete__label',
  },
};

/** Notion's menu chrome (spec §7.1): 220 wide, radius 10, padding 4. */
export const WIDGET_MENU_CONTENT_CLASS = 'w-[220px] !min-w-[220px] !rounded-[10px] !p-1';
/** Items 28 tall, radius 6, padding `0 8`, 14/20 text, 16px icons in the tool icon colour. */
const ITEM_CLASS =
  '!h-7 !min-h-7 !rounded-200 !px-2 !py-0 gap-2 text-sm leading-5 [&_svg]:!h-4 [&_svg]:!w-4 [&_svg]:text-dash-tool-icon';
const SEPARATOR_CLASS = '!-mx-1 !my-1';

function runEntry(id: WidgetMenuEntryId, actions: WidgetActions) {
  switch (id) {
    case 'view-data-source':
      actions.open();
      break;
    case 'edit-view':
      actions.openSettings();
      break;
    case 'move-left':
      actions.move('left');
      break;
    case 'move-right':
      actions.move('right');
      break;
    case 'create-row-above':
      actions.move('rowAbove');
      break;
    case 'create-row-below':
      actions.move('rowBelow');
      break;
    case 'duplicate':
      actions.duplicate();
      break;
    case 'delete':
      actions.remove();
      break;
    case 'move-to-row':
      break;
  }
}

function EntryContent({ id }: { id: WidgetMenuEntryId }) {
  const { t } = useTranslation();
  const Icon = ENTRY_ICONS[id];
  const parity = ENTRY_PARITY_IDS[id];
  const label = ENTRY_LABELS[id];

  return (
    <>
      <Icon aria-hidden='true' data-parity-id={parity.icon} />
      <span className='min-w-0 flex-1 truncate' data-parity-id={parity.label}>
        {t(label.key, { defaultValue: label.defaultValue })}
      </span>
    </>
  );
}

interface EntryProps {
  entry: WidgetMenuEntry;
  actions: WidgetActions;
}

/**
 * "Move to row" opens its submenu to the right, top-aligned, on hover, click
 * or ArrowRight. Its two entries are disabled (not selectable, no tooltip)
 * for a widget alone in its row.
 */
function MoveToRowEntry({ entry, actions }: EntryProps) {
  const parity = ENTRY_PARITY_IDS['move-to-row'];

  return (
    <DropdownMenuSub>
      <DropdownMenuPrimitive.SubTrigger
        className={cn(
          'relative flex cursor-pointer select-none items-center text-text-primary outline-none',
          'hover:bg-fill-content-hover focus:bg-fill-content-hover data-[state=open]:bg-fill-content-hover',
          '[&_svg]:pointer-events-none [&_svg]:shrink-0',
          ITEM_CLASS
        )}
        data-parity-id={parity.item}
        data-testid='dashboard-widget-menu-move-to-row'
      >
        <EntryContent id='move-to-row' />
        <ChevronRightIcon
          aria-hidden='true'
          className='ml-auto !text-icon-tertiary'
          data-parity-id='dash-widget-menu-item-move-to-row__chevron'
        />
      </DropdownMenuPrimitive.SubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className={cn('border border-border-primary data-[side=right]:!ml-0', WIDGET_MENU_CONTENT_CLASS)}
          data-testid='dashboard-widget-menu-move-to-row-content'
          onClick={(event) => event.stopPropagation()}
          sideOffset={4}
        >
          {(entry.children ?? []).map((child) => (
            <DropdownMenuItem
              className={ITEM_CLASS}
              data-parity-id={ENTRY_PARITY_IDS[child.id].item}
              data-testid={`dashboard-widget-menu-${child.id}`}
              disabled={child.disabled}
              key={child.id}
              onSelect={() => runEntry(child.id, actions)}
            >
              <EntryContent id={child.id} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/**
 * Duplicate on a full dashboard: shown in the tertiary colour but not
 * Radix-disabled, so it stays hoverable and shows the "Dashboard is full"
 * tooltip; choosing it keeps the menu open and announces the refusal.
 */
function RefusedDuplicateEntry() {
  const { t } = useTranslation();
  const { announce } = useDashboardUi();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem
          aria-disabled='true'
          className={cn(ITEM_CLASS, '!text-text-tertiary [&_svg]:!text-text-tertiary')}
          data-disabled-reason='dashboard-full'
          data-parity-id={ENTRY_PARITY_IDS.duplicate.item}
          data-testid='dashboard-widget-menu-duplicate'
          onSelect={(event) => {
            event.preventDefault();
            announce(dashboardFullAnnouncement(t));
          }}
        >
          <EntryContent id='duplicate' />
        </DropdownMenuItem>
      </TooltipTrigger>
      <DashboardFullTooltipContent side='right' />
    </Tooltip>
  );
}

function MenuEntry({ entry, actions, onEditView }: EntryProps & { onEditView: () => void }) {
  if (entry.id === 'move-to-row') return <MoveToRowEntry actions={actions} entry={entry} />;
  if (entry.id === 'duplicate' && entry.disabledReason === 'dashboard_full') return <RefusedDuplicateEntry />;

  return (
    <DropdownMenuItem
      className={ITEM_CLASS}
      data-parity-id={ENTRY_PARITY_IDS[entry.id].item}
      data-testid={`dashboard-widget-menu-${entry.id}`}
      disabled={entry.disabled}
      onSelect={() => {
        if (entry.id === 'edit-view') onEditView();
        runEntry(entry.id, actions);
      }}
      // Delete is neutral, as in Notion.
      variant='default'
    >
      <EntryContent id={entry.id} />
    </DropdownMenuItem>
  );
}

interface WidgetMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor element (rendered with `asChild`). */
  children: ReactNode;
  /** `start` under the title pill, `end` under the capsule's options button. */
  align?: 'start' | 'end';
}

/** Outside a dashboard no duplicate is ever in flight. */
const NO_DUPLICATE_IN_FLIGHT = { get: () => null, subscribe: () => () => undefined };

/**
 * The entries of an open menu. Mounted only while the menu is open, so only
 * an open menu follows the dashboard layout. Duplicate is disabled while this
 * widget's duplicate is being created (WP05 §1.4).
 */
function WidgetMenuItems({ onEditView }: { onEditView: () => void }) {
  const { actions, isEditing, canEdit, widgetId } = useWidgetContext();
  const { rows } = useDashboardLayout();
  const duplicatingWidget = useDashboardUiOptional()?.ownedViews.duplicatingWidget ?? NO_DUPLICATE_IN_FLIGHT;
  const isDuplicating = useCallback(() => duplicatingWidget.get() === widgetId, [duplicatingWidget, widgetId]);
  const duplicating = useSyncExternalStore(duplicatingWidget.subscribe, isDuplicating, isDuplicating);
  // Effective Edit mode: in View mode every role, writers included, only views the data source.
  const editing = isEditing && canEdit;
  const entries = useMemo(
    () =>
      buildWidgetMenuEntries({
        editing,
        canDuplicate: canDuplicateWidget(rows, widgetId),
        moveTargets: getWidgetMoveTargets(rows, widgetId),
      }).map((entry) => (entry.id === 'duplicate' && duplicating ? { ...entry, disabled: true } : entry)),
    [duplicating, editing, rows, widgetId]
  );

  return (
    <>
      {entries.map((entry, index) => {
        const previous = entries[index - 1];

        return (
          <Fragment key={entry.id}>
            {previous && previous.group !== entry.group ? <DropdownMenuSeparator className={SEPARATOR_CLASS} /> : null}
            <MenuEntry actions={actions} entry={entry} onEditView={onEditView} />
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * The widget menu (Notion spec §7.1), anchored under the title pill (or the
 * capsule's options button). Edit mode: Edit view, Move left / right, Move to
 * row › Create new row above / below, Duplicate, Delete. View mode: View data
 * source. The pill or the button toggles it, so pressing them does not count
 * as an outside click, and focus goes back to them when the menu closes
 * (unless "Edit view" hands it to the settings host). On a phone the same
 * open state shows the menu as a bottom sheet (`WidgetMenuSheet`).
 */
export function WidgetMenu({ open, onOpenChange, children, align = 'end' }: WidgetMenuProps) {
  const widget = useWidgetContextOptional();
  const getOpener = () => (widget?.showWidgetTitles ? widget.titleRef?.current : widget?.optionsRef?.current) ?? null;
  const settingsTookFocusRef = useRef(false);

  if (widget?.mobileContext) return <WidgetMenuSheet onOpenChange={onOpenChange} open={open} />;

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={WIDGET_MENU_CONTENT_CLASS}
        data-parity-id='dash-widget-menu'
        data-testid='dashboard-widget-menu'
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (settingsTookFocusRef.current) {
            settingsTookFocusRef.current = false;
            return;
          }

          const opener = getOpener();

          if (opener?.isConnected) opener.focus();
        }}
        onInteractOutside={(event) => {
          if (getOpener()?.contains(event.target as Node | null)) event.preventDefault();
        }}
        side='bottom'
        sideOffset={4}
      >
        <WidgetMenuItems
          onEditView={() => {
            settingsTookFocusRef.current = true;
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default WidgetMenu;
