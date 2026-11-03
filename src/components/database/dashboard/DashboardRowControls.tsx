import { memo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DashboardAddControlState } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/arrow_down.svg';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  DASHBOARD_ADD_ROW_BUTTON_SIZE,
  DASHBOARD_MOTION_FAST_CLASS,
  DASHBOARD_ROW_CONTROL_OFFSET,
  DASHBOARD_ROW_CONTROL_SIZE,
  DASHBOARD_WIDGET_BOX_INSET,
} from './constants';
import { DASHBOARD_TOOLTIP_CLASS, DashboardFullTooltipContent } from './DashboardFullTooltip';

/**
 * The controls beside a row in Edit mode (Notion spec §6.4): the ↑/↓ move
 * control centred 30px outside the content column on the left, the "+" (Add
 * to row) mirrored on the right, and the "+" (Add to new row) under the last
 * row. Round, tinted buttons with an accent glyph; the hover fill is an
 * overlay, the focus ring the accent.
 */

/** From the content column's edge to the outer edge of the hit area that keeps the row hovered. */
const ROW_CONTROL_HIT_EXTENT = 48;
const EXTENDER_WIDTH = ROW_CONTROL_HIT_EXTENT - DASHBOARD_WIDGET_BOX_INSET;
/** The extender starts where the widget boxes end (they bleed the box inset past the column). */
const EXTENDER_OFFSET = `calc(100% + ${DASHBOARD_WIDGET_BOX_INSET}px)`;
/** The control's centre, measured from the extender's inner edge (the widget box edge). */
const CONTROL_CENTER_FROM_EXTENDER = DASHBOARD_ROW_CONTROL_OFFSET - DASHBOARD_WIDGET_BOX_INSET;

/**
 * Fades in while the row is hovered or anything in it has focus (150ms), and
 * stays shown where nothing hovers (tablets in Edit mode).
 */
export const ROW_CONTROL_REVEAL_CLASS = cn(
  'opacity-0 transition-opacity motion-reduce:transition-none',
  DASHBOARD_MOTION_FAST_CLASS,
  'group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100'
);

const FOCUS_RING_CLASS = 'outline-none focus-visible:ring-2 focus-visible:ring-dash-accent';
/** A round control with the tinted fill; the hover fill is laid over it. */
const ROUND_CONTROL_CLASS = cn(
  'relative flex shrink-0 items-center justify-center rounded-full bg-dash-row-control-bg text-dash-accent',
  'before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-dash-hover-fill before:opacity-0 hover:before:opacity-100',
  '[&>svg]:relative [&>svg]:h-4 [&>svg]:w-4',
  FOCUS_RING_CLASS
);
const DISABLED_CONTROL_CLASS = 'cursor-default opacity-40';

function ControlTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className={DASHBOARD_TOOLTIP_CLASS} data-parity-id='dash-tooltip' side='top' sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The transparent strip between the row's widget boxes and a control: the
 * pointer travelling to the control never leaves the row, so the control
 * stays shown.
 */
function ControlExtender({ side, children }: { side: 'start' | 'end'; children: ReactNode }) {
  return (
    <div
      className='absolute inset-y-0'
      data-side={side}
      data-testid='dashboard-row-control-anchor'
      style={
        side === 'start'
          ? { width: EXTENDER_WIDTH, right: EXTENDER_OFFSET }
          : { width: EXTENDER_WIDTH, left: EXTENDER_OFFSET }
      }
    >
      {children}
    </div>
  );
}

/** Centres a control `DASHBOARD_ROW_CONTROL_OFFSET` outside the content column, on the row block's middle. */
function controlPosition(side: 'start' | 'end') {
  return side === 'start'
    ? { top: '50%', right: CONTROL_CENTER_FROM_EXTENDER, transform: 'translate(50%, -50%)' }
    : { top: '50%', left: CONTROL_CENTER_FROM_EXTENDER, transform: 'translate(-50%, -50%)' };
}

interface RowMoveControlProps {
  rowId: string;
  moveUp: boolean;
  moveDown: boolean;
  onMove: (delta: -1 | 1) => void;
}

/**
 * ↓ on the first row, ↑ over ↓ in the middle, ↑ on the last; a single row
 * gets none. One arrow is a 24px circle, two make a 24×48 pill.
 */
export const RowMoveControl = memo(function RowMoveControl({ rowId, moveUp, moveDown, onMove }: RowMoveControlProps) {
  const { t } = useTranslation();

  if (!moveUp && !moveDown) return null;
  const arrowClass = cn(
    'relative flex shrink-0 items-center justify-center rounded-full text-dash-accent transition-colors hover:bg-dash-hover-fill motion-reduce:transition-none',
    DASHBOARD_MOTION_FAST_CLASS,
    FOCUS_RING_CLASS
  );
  const arrowStyle = { width: DASHBOARD_ROW_CONTROL_SIZE, height: DASHBOARD_ROW_CONTROL_SIZE };
  const upLabel = t('dashboard.row.moveUp', { defaultValue: 'Move up' });
  const downLabel = t('dashboard.row.moveDown', { defaultValue: 'Move down' });

  return (
    <ControlExtender side='start'>
      <div
        className={cn('absolute flex flex-col rounded-full bg-dash-row-control-bg', ROW_CONTROL_REVEAL_CLASS)}
        data-parity-id='dash-row-control-move'
        data-row-id={rowId}
        data-testid='dashboard-row-move-control'
        style={{ ...controlPosition('start'), width: DASHBOARD_ROW_CONTROL_SIZE }}
      >
        {moveUp ? (
          <ControlTooltip label={upLabel}>
            <button
              aria-label={upLabel}
              className={arrowClass}
              data-parity-id='dash-row-control-move-up'
              data-row-id={rowId}
              data-testid='dashboard-row-move-up'
              onClick={() => onMove(-1)}
              style={arrowStyle}
              type='button'
            >
              <ArrowUpIcon aria-hidden='true' className='h-4 w-4' data-parity-id='dash-row-control-move-up__icon' />
            </button>
          </ControlTooltip>
        ) : null}
        {moveDown ? (
          <ControlTooltip label={downLabel}>
            <button
              aria-label={downLabel}
              className={arrowClass}
              data-parity-id='dash-row-control-move-down'
              data-row-id={rowId}
              data-testid='dashboard-row-move-down'
              onClick={() => onMove(1)}
              style={arrowStyle}
              type='button'
            >
              <ArrowDownIcon aria-hidden='true' className='h-4 w-4' data-parity-id='dash-row-control-move-down__icon' />
            </button>
          </ControlTooltip>
        ) : null}
      </div>
    </ControlExtender>
  );
});

interface RowAddControlProps {
  rowId: string;
  state: DashboardAddControlState;
  /** Opens the add flow at the end of the row. */
  onAdd: () => void;
  /** A press on the control while the dashboard is full: announced, nothing opens. */
  onRefuse: () => void;
  /** Warms the widget picker's catalog. */
  onPreload: () => void;
}

/**
 * "+" (Add to row): hidden for a full row; on a full dashboard it stays
 * focusable and hoverable at 40% with the "Dashboard is full" tooltip.
 */
export const RowAddControl = memo(function RowAddControl({
  rowId,
  state,
  onAdd,
  onRefuse,
  onPreload,
}: RowAddControlProps) {
  const { t } = useTranslation();

  if (state === 'hidden') return null;
  const disabled = state === 'disabled';
  const label = t('dashboard.row.addToRow', { defaultValue: 'Add to row' });
  const button = (
    <button
      aria-disabled={disabled ? 'true' : undefined}
      aria-label={label}
      className={cn(ROUND_CONTROL_CLASS, disabled && DISABLED_CONTROL_CLASS)}
      data-parity-id='dash-row-control-add'
      data-row-id={rowId}
      data-testid='dashboard-add-widget-row-button'
      onClick={disabled ? onRefuse : onAdd}
      onFocus={disabled ? undefined : onPreload}
      onPointerEnter={disabled ? undefined : onPreload}
      style={{ width: DASHBOARD_ROW_CONTROL_SIZE, height: DASHBOARD_ROW_CONTROL_SIZE }}
      type='button'
    >
      <PlusIcon aria-hidden='true' data-parity-id='dash-row-control-add__icon' />
    </button>
  );

  return (
    <ControlExtender side='end'>
      <div className={cn('absolute', ROW_CONTROL_REVEAL_CLASS)} style={controlPosition('end')}>
        {disabled ? (
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <DashboardFullTooltipContent side='top' />
          </Tooltip>
        ) : (
          <ControlTooltip label={label}>{button}</ControlTooltip>
        )}
      </div>
    </ControlExtender>
  );
});

interface AddToNewRowButtonProps {
  state: Exclude<DashboardAddControlState, 'hidden'>;
  /** A widget is being dragged: the button gives way to the drop zone below the last row. */
  hidden: boolean;
  onAdd: () => void;
  onRefuse: () => void;
  onPreload: () => void;
}

/**
 * "+" (Add to new row): a 28px circle centred one row gap under the last
 * row, always shown in Edit mode (never faded), disabled with the "Dashboard
 * is full" tooltip on a full dashboard.
 */
export const AddToNewRowButton = memo(function AddToNewRowButton({
  state,
  hidden,
  onAdd,
  onRefuse,
  onPreload,
}: AddToNewRowButtonProps) {
  const { t } = useTranslation();
  const disabled = state === 'disabled';
  const label = t('dashboard.row.addToNewRow', { defaultValue: 'Add to new row' });
  const button = (
    <button
      aria-disabled={disabled ? 'true' : undefined}
      aria-label={label}
      className={cn(ROUND_CONTROL_CLASS, disabled && DISABLED_CONTROL_CLASS)}
      data-parity-id='dash-grid-add-row'
      data-testid='dashboard-add-widget-button'
      onClick={disabled ? onRefuse : onAdd}
      onFocus={disabled ? undefined : onPreload}
      onPointerEnter={disabled ? undefined : onPreload}
      style={{ width: DASHBOARD_ADD_ROW_BUTTON_SIZE, height: DASHBOARD_ADD_ROW_BUTTON_SIZE }}
      type='button'
    >
      <PlusIcon aria-hidden='true' data-parity-id='dash-grid-add-row__icon' />
      <span className='sr-only' data-parity-id='dash-grid-add-row__label'>
        {label}
      </span>
    </button>
  );

  return (
    <div
      className={cn('flex justify-center', hidden && 'pointer-events-none opacity-0')}
      data-hidden={hidden ? 'true' : undefined}
      data-testid='dashboard-add-row-slot'
    >
      {disabled ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <DashboardFullTooltipContent side='top' />
        </Tooltip>
      ) : (
        <ControlTooltip label={label}>{button}</ControlTooltip>
      )}
    </div>
  );
});
