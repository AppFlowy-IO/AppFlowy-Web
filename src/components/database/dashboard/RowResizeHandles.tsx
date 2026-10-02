import { FocusEvent, KeyboardEvent, memo, PointerEvent, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_MAX_ROW_HEIGHT, DASHBOARD_MIN_ROW_HEIGHT } from '@/application/database-yjs/dashboard.type';
import { cn } from '@/lib/utils';

import { DASHBOARD_RESIZE_GEOMETRY } from './constants';
import { RowHeightPreview } from './hooks/useRowHeightResize';
import { getWidthHandleBounds } from './hooks/useWidthResize';

export type ResizeHandleState = 'idle' | 'hover' | 'active';

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
  /** The row's widths, including a running preview. */
  widths: number[];
  /** Resize minimum of the row (`dashboardMinWidgetColumns`), for the accessible range. */
  minColumns: number;
  /** CSS `left` of the handle's centre (`getWidthHandleCenter`). */
  center: string;
  active: boolean;
  /** A widget drag is in progress: the handle must not catch the pointer. */
  inert: boolean;
  onKeyDown: (index: number, event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (index: number, event: PointerEvent<HTMLElement>) => void;
}

/**
 * The width handle in the gap between two widgets of an unwrapped row: a
 * strip as wide as the visible card gap, invisible until it is hovered. A
 * faint pill shows on hover; a drag or keyboard focus turns it accent.
 */
export const WidthResizeHandle = memo(function WidthResizeHandle({
  rowId,
  index,
  widths,
  minColumns,
  center,
  active,
  inert,
  onKeyDown,
  onPointerDown,
}: WidthResizeHandleProps) {
  const { t } = useTranslation();
  const { state, handlers } = useHandleState(active);
  const columns = widths[index] ?? 0;
  const bounds = getWidthHandleBounds(widths, index, minColumns);

  return (
    <div
      aria-label={t('dashboard.widget.resizeWidth', { defaultValue: 'Drag to resize' })}
      aria-orientation='vertical'
      aria-valuemax={bounds.max}
      aria-valuemin={bounds.min}
      aria-valuenow={columns}
      aria-valuetext={t('dashboard.widget.resizeWidthValue', {
        columns,
        defaultValue: '{{columns}} of 12 columns',
      })}
      className={cn(
        // `touch-none`: a touch pan would cancel the pointer drag.
        'group/handle absolute inset-y-0 z-10 -translate-x-1/2 cursor-col-resize touch-none outline-none',
        inert && 'pointer-events-none'
      )}
      data-active={active ? 'true' : undefined}
      data-index={index}
      data-parity-id='dash-resize-width-handle'
      data-row-id={rowId}
      data-testid='dashboard-width-handle'
      onKeyDown={(event) => onKeyDown(index, event)}
      onPointerDown={(event) => onPointerDown(index, event)}
      role='separator'
      style={{ left: center, width: DASHBOARD_RESIZE_GEOMETRY.hitWidth }}
      tabIndex={0}
      {...handlers}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-primary opacity-0',
          'transition-[opacity,background-color,width] duration-150 ease-in-out motion-reduce:transition-none',
          'data-[state=active]:w-[3px] data-[state=active]:bg-dash-accent data-[state=active]:opacity-100 data-[state=hover]:opacity-100'
        )}
        data-parity-id='dash-resize-width-handle__pill'
        data-state={state}
        data-testid='dashboard-resize-pill'
        // Centred on the card region below the 40px header; clamp(40, 33%, 60) of the row height.
        style={{ top: 'calc(40px + (100% - 46px) / 2)', height: 'clamp(40px, 33%, 60px)' }}
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
  /** A widget drag is in progress: the handle must not catch the pointer. */
  inert: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}

/**
 * The height handle: the whole band below a row. It alone follows the drag
 * through React (for its value): the row and its cards resize through CSS.
 * Its band sits on the row's bottom edge, invisible until hovered, and turns
 * into a thin accent line while dragging. No size badge.
 */
export const RowHeightHandle = memo(function RowHeightHandle({
  rowId,
  height,
  preview,
  dragging,
  inert,
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
        'group/height pointer-events-auto absolute inset-0 cursor-row-resize touch-none outline-none',
        inert && 'pointer-events-none'
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
          'pointer-events-none absolute inset-x-0 top-0 h-1 rounded-full bg-dash-row-control-bg opacity-0',
          'transition-[opacity,background-color,height] duration-150 ease-in-out motion-reduce:transition-none',
          'data-[state=active]:h-0.5 data-[state=active]:bg-dash-accent data-[state=active]:opacity-100 data-[state=hover]:opacity-100'
        )}
        data-parity-id='dash-resize-height-handle__band'
        data-state={state}
        data-testid='dashboard-resize-band'
      />
    </div>
  );
});
