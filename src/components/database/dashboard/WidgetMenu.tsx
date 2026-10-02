import { ComponentType, Fragment, ReactNode, SVGProps, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_MAX_WIDGETS } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/arrow_down.svg';
import { ReactComponent as ArrowLeftIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as ArrowRightIcon } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as OpenIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as ChangeViewIcon } from '@/assets/icons/layout.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useDashboardLayout } from './DashboardContext';
import { canDuplicateWidget, getWidgetMoveTargets, WidgetMoveDirection, WidgetMoveTargets } from './widget-moves';
import { useWidgetContext, useWidgetContextOptional, WidgetActions } from './WidgetContext';

export type WidgetMenuEntryId =
  | 'open'
  | 'change-view'
  | 'duplicate'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'delete';

export interface WidgetMenuEntry {
  id: WidgetMenuEntryId;
  group: 'navigate' | 'edit' | 'move' | 'danger';
  labelKey: string;
  defaultLabel: string;
  disabled: boolean;
  /**
   * The dashboard is full. The entry stays selectable (a disabled Radix item
   * never fires) so choosing it can explain the widget limit.
   */
  limitReached?: boolean;
}

interface MoveEntry {
  id: WidgetMenuEntryId;
  direction: WidgetMoveDirection;
  labelKey: string;
  defaultLabel: string;
}

const MOVE_ENTRIES: MoveEntry[] = [
  { id: 'move-left', direction: 'left', labelKey: 'dashboard.widget.moveLeft', defaultLabel: 'Move left' },
  { id: 'move-right', direction: 'right', labelKey: 'dashboard.widget.moveRight', defaultLabel: 'Move right' },
  { id: 'move-up', direction: 'up', labelKey: 'dashboard.widget.moveUp', defaultLabel: 'Move up' },
  { id: 'move-down', direction: 'down', labelKey: 'dashboard.widget.moveDown', defaultLabel: 'Move down' },
];

/**
 * Menu entries and their enabled state. In View mode (`editing` false) only
 * "Open view" is offered; layout changes need Edit mode.
 */
export function buildWidgetMenuEntries({
  editing,
  canDuplicate,
  moveTargets,
}: {
  editing: boolean;
  canDuplicate: boolean;
  moveTargets: WidgetMoveTargets;
}): WidgetMenuEntry[] {
  const entries: WidgetMenuEntry[] = [
    { id: 'open', group: 'navigate', labelKey: 'dashboard.widget.open', defaultLabel: 'Open view', disabled: false },
  ];

  if (!editing) return entries;

  entries.push(
    {
      id: 'change-view',
      group: 'edit',
      labelKey: 'dashboard.widget.changeView',
      defaultLabel: 'Change view',
      disabled: false,
    },
    {
      id: 'duplicate',
      group: 'edit',
      labelKey: 'dashboard.widget.duplicate',
      defaultLabel: 'Duplicate',
      disabled: false,
      limitReached: !canDuplicate,
    },
    ...MOVE_ENTRIES.map<WidgetMenuEntry>(({ id, direction, labelKey, defaultLabel }) => ({
      id,
      group: 'move',
      labelKey,
      defaultLabel,
      disabled: moveTargets[direction] === null,
    })),
    { id: 'delete', group: 'danger', labelKey: 'dashboard.widget.delete', defaultLabel: 'Delete', disabled: false }
  );

  return entries;
}

const ENTRY_ICONS: Record<WidgetMenuEntryId, ComponentType<SVGProps<SVGSVGElement>>> = {
  open: OpenIcon,
  'change-view': ChangeViewIcon,
  duplicate: DuplicateIcon,
  'move-left': ArrowLeftIcon,
  'move-right': ArrowRightIcon,
  'move-up': ArrowUpIcon,
  'move-down': ArrowDownIcon,
  delete: DeleteIcon,
};

/**
 * Visual parity ids of the entries that have a counterpart in the desktop
 * menu (`dashboard-parity/visual-metrics.json`); "Open view" is the reader's
 * "View data source".
 */
const ENTRY_PARITY_IDS: Partial<Record<WidgetMenuEntryId, { item: string; icon: string; label: string }>> = {
  open: {
    item: 'dash-widget-menu-item-view-data-source',
    icon: 'dash-widget-menu-item-view-data-source__icon',
    label: 'dash-widget-menu-item-view-data-source__label',
  },
  duplicate: {
    item: 'dash-widget-menu-item-duplicate',
    icon: 'dash-widget-menu-item-duplicate__icon',
    label: 'dash-widget-menu-item-duplicate__label',
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
  delete: {
    item: 'dash-widget-menu-item-delete',
    icon: 'dash-widget-menu-item-delete__icon',
    label: 'dash-widget-menu-item-delete__label',
  },
};

function runEntry(id: WidgetMenuEntryId, actions: WidgetActions) {
  switch (id) {
    case 'open':
      actions.open();
      break;
    case 'change-view':
      actions.changeView();
      break;
    case 'duplicate':
      actions.duplicate();
      break;
    case 'move-left':
      actions.move('left');
      break;
    case 'move-right':
      actions.move('right');
      break;
    case 'move-up':
      actions.move('up');
      break;
    case 'move-down':
      actions.move('down');
      break;
    case 'delete':
      actions.remove();
      break;
  }
}

interface WidgetMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor element (rendered with `asChild`). */
  children: ReactNode;
  /** `start` under the title pill, `end` under the capsule's options button. */
  align?: 'start' | 'end';
}

/**
 * The entries of an open menu. Mounted only while the menu is open, so only
 * an open menu follows the dashboard layout.
 */
function WidgetMenuItems() {
  const { t } = useTranslation();
  const { actions, isEditing, canEdit, widgetId } = useWidgetContext();
  const { rows } = useDashboardLayout();
  const editing = isEditing && canEdit;
  const entries = useMemo(
    () =>
      buildWidgetMenuEntries({
        editing,
        canDuplicate: canDuplicateWidget(rows, widgetId),
        moveTargets: getWidgetMoveTargets(rows, widgetId),
      }),
    [editing, rows, widgetId]
  );
  const limitText = t('dashboard.widgetLimit', {
    count: DASHBOARD_MAX_WIDGETS,
    defaultValue: 'Dashboards support up to {{count}} widgets.',
  });

  return (
    <>
      {entries.map((entry, index) => {
        const Icon = ENTRY_ICONS[entry.id];
        const parity = ENTRY_PARITY_IDS[entry.id];
        const previous = entries[index - 1];

        return (
          <Fragment key={entry.id}>
            {previous && previous.group !== entry.group ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className={cn(entry.limitReached && 'text-text-tertiary')}
              data-limit-reached={entry.limitReached ? 'true' : undefined}
              data-parity-id={parity?.item}
              data-testid={`dashboard-widget-menu-${entry.id}`}
              disabled={entry.disabled}
              onSelect={() => runEntry(entry.id, actions)}
              title={entry.limitReached ? limitText : undefined}
              variant={entry.group === 'danger' ? 'destructive' : 'default'}
            >
              <Icon aria-hidden='true' data-parity-id={parity?.icon} />
              <span data-parity-id={parity?.label}>{t(entry.labelKey, { defaultValue: entry.defaultLabel })}</span>
            </DropdownMenuItem>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Options of one dashboard widget, anchored under the title pill (or the
 * capsule's options button). The pill or the button toggles it, so pressing
 * them does not count as an outside click, and focus goes back to them when
 * the menu closes.
 */
export function WidgetMenu({ open, onOpenChange, children, align = 'end' }: WidgetMenuProps) {
  const widget = useWidgetContextOptional();
  const getOpener = () => (widget?.showWidgetTitles ? widget.titleRef?.current : widget?.optionsRef?.current) ?? null;

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className='!min-w-[200px]'
        data-parity-id='dash-widget-menu'
        data-testid='dashboard-widget-menu'
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = getOpener();

          if (opener?.isConnected) opener.focus();
        }}
        onInteractOutside={(event) => {
          if (getOpener()?.contains(event.target as Node | null)) event.preventDefault();
        }}
        side='bottom'
        sideOffset={4}
      >
        <WidgetMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default WidgetMenu;
