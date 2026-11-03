import { FocusEvent, KeyboardEvent, memo, PointerEvent, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_MAX_ROW_HEIGHT, DASHBOARD_MIN_ROW_HEIGHT } from '@/application/database-yjs/dashboard.type';
import { cn } from '@/lib/utils';

import { DASHBOARD_MOTION_FAST_CLASS, DASHBOARD_RESIZE_GEOMETRY } from './constants';
import { RowHeightPreview } from './hooks/useRowHeightResize';

export type ResizeHandleState = 'idle' | 'hover' | 'active';

const { hitWidth, pillMin, pillFraction, pillMax, pillWidthHover, pillWidthActive, bandHover, bandActive } =
  DASHBOARD_RESIZE_GEOMETRY;

/** Length of the width pill: a third of the row height, between 40 and 60px. */
const PILL_HEIGHT = `clamp(${pillMin}px, ${Math.round(pillFraction * 10000) / 100}%, ${pillMax}px)`;
/** A widget drag is in progress (`data-dragging` on the dashboard): the handle must not catch the pointer. */
const INERT_WHILE_DRAGGING_CLASS = 'group-data-[dragging=true]/dashboard:pointer-events-none';

/** Place and size of the width pill: centred on `top`, 2px wide, 3px while active. */
export function getWidthPillStyle(state: ResizeHandleState, top: string) {
  return { top, height: PILL_HEIGHT, width: state === 'active' ? pillWidthActive : pillWidthHover };
}

/** Height of the band of the height handle: 4px, 2px while active. */
export function getHeightBandStyle(state: ResizeHandleState) {
  return { height: state === 'active' ? bandActive : bandHover };
}

/** Keyboard focus (not a pointer press) highlights a handle like a drag does. */
function isFocusVisible(event: FocusEvent<HTMLElement>) {
  try {
    return event.currentTarget.matches(':focus-visible');
  } catch {
    return false;
  }
}

function useHandleState(active: boolean) {
  const [hovered, setHovered] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const state: ResizeHandleState = active || focusVisible ? 'active' : hovered ? 'hover' : 'idle';

  return {
    state,
    handlers: {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: (event: FocusEvent<HTMLElement>) => setFocusVisible(isFocusVisible(event)),
      onBlur: () => setFocusVisible(false),
    },
  };
}

interface WidthResizeHandleProps {
  rowId: string;
  /** The boundary after the widget at `index`. */
  index: number;
  // Primitives, not the row's widths (a new array on every render of the row):
  // the handle only renders when one of its own values changes.
  /** Columns of the widget before the handle, including a running preview. */
  columns: number;
  /** The widths that widget can reach (`getWidthHandleBounds`), for the accessible range. */
  minColumns: number;
  maxColumns: number;
  /** CSS `left` of the handle's centre (`getWidthHandleCenter`). */
  center: string;
  /** CSS `top` of the pill's centre: the centre of the cards (`getWidgetCardCenter`). */
  pillTop: string;
  active: boolean;
  onKeyDown: (index: number, event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (index: number, event: PointerEvent<HTMLElement>) => void;
}

/**
 * The width handle in the gap between two widgets of an unwrapped row: a
 * strip as wide as the visible card gap, invisible until it is hovered. A
 * faint pill shows on hover; a drag or keyboard focus turns it accent. Its
 * sizes are those of `tokens.json` `geometry.resize`.
 */
export const WidthResizeHandle = memo(function WidthResizeHandle({
  rowId,
  index,
  columns,
  minColumns,
  maxColumns,
  center,
  pillTop,
  active,
  onKeyDown,
  onPointerDown,
}: WidthResizeHandleProps) {
  const { t } = useTranslation();
  const { state, handlers } = useHandleState(active);

  return (
    <div
      aria-label={t('dashboard.widget.resizeWidth', { defaultValue: 'Drag to resize' })}
      aria-orientation='vertical'
      aria-valuemax={maxColumns}
      aria-valuemin={minColumns}
      aria-valuenow={columns}
      aria-valuetext={t('dashboard.widget.resizeWidthValue', {
        columns,
        defaultValue: '{{columns}} of 12 columns',
      })}
      className={cn(
        // `touch-none`: a touch pan would cancel the pointer drag.
        'group/handle absolute inset-y-0 z-10 -translate-x-1/2 cursor-col-resize touch-none outline-none',
        INERT_WHILE_DRAGGING_CLASS
      )}
      data-active={active ? 'true' : undefined}
      data-index={index}
      data-parity-id='dash-resize-width-handle'
      data-row-id={rowId}
      data-testid='dashboard-width-handle'
      onKeyDown={(event) => onKeyDown(index, event)}
      onPointerDown={(event) => onPointerDown(index, event)}
      role='separator'
      style={{ left: center, width: hitWidth }}
      tabIndex={0}
      {...handlers}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-primary opacity-0',
          'transition-[opacity,background-color,width] motion-reduce:transition-none',
          DASHBOARD_MOTION_FAST_CLASS,
          'data-[state=active]:bg-dash-accent data-[state=active]:opacity-100 data-[state=hover]:opacity-100'
        )}
        data-parity-id='dash-resize-width-handle__pill'
        data-state={state}
        data-testid='dashboard-resize-pill'
        style={getWidthPillStyle(state, pillTop)}
      />
    </div>
  );
});

interface RowHeightHandleProps {
  rowId: string;
  /** The persisted height; a drag previews another one. */
  height: number;
  preview: RowHeightPreview;
  dragging: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}

/**
 * The height handle: the whole band below a row. It alone follows the drag
 * through React (for its value): the row and its cards resize through CSS.
 * Its band sits on the row's bottom edge, invisible until hovered, and turns
 * into a thin accent line while dragging (`geometry.resize` `bandHover` and
 * `bandActive`). No size badge.
 */
export const RowHeightHandle = memo(function RowHeightHandle({
  rowId,
  height,
  preview,
  dragging,
  onKeyDown,
  onPointerDown,
}: RowHeightHandleProps) {
  const { t } = useTranslation();
  const { state, handlers } = useHandleState(dragging);
  const previewHeight = useSyncExternalStore(preview.subscribe, preview.get, preview.get);
  const liveHeight = previewHeight ?? height;

  return (
    <div
      aria-label={t('dashboard.widget.resizeHeight', { defaultValue: 'Drag to change row height' })}
      aria-orientation='horizontal'
      aria-valuemax={DASHBOARD_MAX_ROW_HEIGHT}
      aria-valuemin={DASHBOARD_MIN_ROW_HEIGHT}
      aria-valuenow={liveHeight}
      aria-valuetext={t('dashboard.widget.resizeHeightValue', {
        height: liveHeight,
        defaultValue: '{{height}} pixels',
      })}
      className={cn(
        // The band around it only catches the pointer while a widget is dragged; the handle the rest of the time.
        'group/height pointer-events-auto absolute inset-0 cursor-row-resize touch-none outline-none',
        INERT_WHILE_DRAGGING_CLASS
      )}
      data-active={dragging ? 'true' : undefined}
      data-parity-id='dash-resize-height-handle'
      data-row-id={rowId}
      data-testid='dashboard-height-handle'
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role='separator'
      tabIndex={0}
      {...handlers}
    >
      <span
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 rounded-full bg-dash-row-control-bg opacity-0',
          'transition-[opacity,background-color,height] motion-reduce:transition-none',
          DASHBOARD_MOTION_FAST_CLASS,
          'data-[state=active]:bg-dash-accent data-[state=active]:opacity-100 data-[state=hover]:opacity-100'
        )}
        data-parity-id='dash-resize-height-handle__band'
        data-state={state}
        data-testid='dashboard-resize-band'
        style={getHeightBandStyle(state)}
      />
    </div>
  );
});
