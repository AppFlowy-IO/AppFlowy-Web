import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { RefObject, useEffect, useRef, useState } from 'react';

import { findDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import {
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DashboardRow,
  DashboardWidgetPlacement,
} from '@/application/database-yjs/dashboard.type';

import { DASHBOARD_ROW_GAP_DROP_TYPE, DASHBOARD_WIDGET_DRAG_TYPE, DASHBOARD_WIDGET_DROP_TYPE } from '../constants';

export type WidgetDropEdge = 'left' | 'right';

export type DashboardDropTarget =
  | { type: 'widget'; widgetId: string; edge: WidgetDropEdge }
  | { type: 'row-gap'; rowIndex: number };

/** `blocked` = a real move the limits refuse; `noop` = the widget would not move. */
export type DashboardDropFeedback = 'allowed' | 'blocked' | 'noop';

/**
 * Classify dropping `sourceWidgetId` on `target`. Dropping next to a widget of
 * another row needs a free slot in that row; reordering inside a row always
 * fits. A widget alone in its row dropped into the gap right above or below
 * that row stays where it is.
 */
export function getDropFeedback(
  rows: DashboardRow[],
  sourceWidgetId: string,
  target: DashboardDropTarget
): DashboardDropFeedback {
  const source = findDashboardWidget(rows, sourceWidgetId);

  if (!source) return 'noop';

  if (target.type === 'widget') {
    if (target.widgetId === sourceWidgetId) return 'noop';
    const destination = findDashboardWidget(rows, target.widgetId);

    if (!destination) return 'noop';

    if (destination.row.id !== source.row.id) {
      return destination.row.widgets.length >= DASHBOARD_MAX_WIDGETS_PER_ROW ? 'blocked' : 'allowed';
    }

    const insertAt = target.edge === 'left' ? destination.index : destination.index + 1;

    return insertAt === source.index || insertAt === source.index + 1 ? 'noop' : 'allowed';
  }

  const rowIndex = Math.max(0, Math.min(target.rowIndex, rows.length));

  if (source.row.widgets.length === 1 && (rowIndex === source.rowIndex || rowIndex === source.rowIndex + 1)) {
    return 'noop';
  }

  return 'allowed';
}

/** The `moveDashboardWidget` placement of a drop, or `null` when nothing should change. */
export function resolveDropPlacement(
  rows: DashboardRow[],
  sourceWidgetId: string,
  target: DashboardDropTarget
): DashboardWidgetPlacement | null {
  if (getDropFeedback(rows, sourceWidgetId, target) !== 'allowed') return null;
  const source = findDashboardWidget(rows, sourceWidgetId);

  if (!source) return null;

  if (target.type === 'row-gap') {
    return { type: 'new_row', rowIndex: Math.max(0, Math.min(target.rowIndex, rows.length)) };
  }

  const destination = findDashboardWidget(rows, target.widgetId);

  if (!destination) return null;
  let index = target.edge === 'left' ? destination.index : destination.index + 1;

  // `moveDashboardWidget` inserts into the row after removing the widget.
  if (destination.row.id === source.row.id && source.index < index) index -= 1;
  return { type: 'existing_row', rowId: destination.row.id, index };
}

interface SourceData {
  type: string;
  instanceId: symbol;
  widgetId: string;
}

type DragData = Record<string | symbol, unknown>;

function isWidgetSource(data: DragData, instanceId: symbol): data is DragData & SourceData {
  return data.type === DASHBOARD_WIDGET_DRAG_TYPE && data.instanceId === instanceId && typeof data.widgetId === 'string';
}

/** The innermost drop target of `instanceId` among `targets` (innermost first). */
export function findDashboardDropTarget(targets: DragData[], instanceId: symbol): DashboardDropTarget | null {
  for (const data of targets) {
    if (data.instanceId !== instanceId) continue;
    const target = parseDropTarget(data);

    if (target) return target;
  }

  return null;
}

export function parseDropTarget(data: DragData): DashboardDropTarget | null {
  if (data.type === DASHBOARD_WIDGET_DROP_TYPE && typeof data.widgetId === 'string') {
    const edge = extractClosestEdge(data);

    if (edge !== 'left' && edge !== 'right') return null;
    return { type: 'widget', widgetId: data.widgetId, edge };
  }

  if (data.type === DASHBOARD_ROW_GAP_DROP_TYPE && typeof data.rowIndex === 'number') {
    return { type: 'row-gap', rowIndex: data.rowIndex };
  }

  return null;
}

interface UseDashboardDndMonitorOptions {
  instanceId: symbol;
  enabled: boolean;
  getRows: () => DashboardRow[];
  onMove: (widgetId: string, placement: DashboardWidgetPlacement) => void;
  scrollContainerRef: RefObject<HTMLElement>;
}

/**
 * Owns drops for one dashboard: resolves the innermost target into a
 * placement, auto-scrolls the dashboard while dragging near its edges, and
 * reports which widget is being dragged.
 */
export function useDashboardDndMonitor({
  instanceId,
  enabled,
  getRows,
  onMove,
  scrollContainerRef,
}: UseDashboardDndMonitorOptions) {
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  const getRowsRef = useRef(getRows);
  const onMoveRef = useRef(onMove);

  getRowsRef.current = getRows;
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!enabled) {
      setDraggingWidgetId(null);
      return;
    }

    const cleanups = [
      monitorForElements({
        canMonitor: ({ source }) => isWidgetSource(source.data, instanceId),
        onDragStart: ({ source }) => {
          setDraggingWidgetId(String(source.data.widgetId));
        },
        onDrop: ({ location, source }) => {
          setDraggingWidgetId(null);
          // The innermost target may belong to the nested database (a board
          // column, a grid row); use the innermost dashboard target instead.
          const target = findDashboardDropTarget(
            location.current.dropTargets.map((dropTarget) => dropTarget.data),
            instanceId
          );

          if (!target) return;
          const widgetId = String(source.data.widgetId);
          const placement = resolveDropPlacement(getRowsRef.current(), widgetId, target);

          if (placement) onMoveRef.current(widgetId, placement);
        },
      }),
    ];
    const scrollElement = scrollContainerRef.current;

    if (scrollElement) {
      cleanups.push(
        autoScrollForElements({
          element: scrollElement,
          canScroll: ({ source }) => isWidgetSource(source.data, instanceId),
        })
      );
    }

    return combine(...cleanups);
  }, [enabled, instanceId, scrollContainerRef]);

  return draggingWidgetId;
}

function renderDragPreview(container: HTMLElement, label: string, width: number) {
  const preview = document.createElement('div');
  const title = document.createElement('div');

  const previewStyle: Partial<CSSStyleDeclaration> = {
    width: `${Math.max(160, Math.min(width, 320))}px`,
    padding: '10px 12px',
    borderRadius: '12px',
    border: '1px solid var(--border-theme-thick)',
    background: 'var(--surface-primary)',
    boxShadow: 'var(--custom-shadow-md)',
    opacity: '0.85',
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontWeight: '500',
  };
  const titleStyle: Partial<CSSStyleDeclaration> = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  Object.assign(preview.style, previewStyle);
  Object.assign(title.style, titleStyle);
  title.textContent = label;
  preview.appendChild(title);
  container.appendChild(preview);

  return () => container.replaceChildren();
}

interface UseDraggableWidgetOptions {
  handle: HTMLElement | null;
  widgetId: string;
  instanceId: symbol;
  enabled: boolean;
  /** Label of the translucent drag preview. */
  label: string;
  /** Returns the card, whose width sizes the preview. */
  getCardElement: () => HTMLElement | null;
}

/** Make the widget header a drag handle (Edit mode). */
export function useDraggableWidget({
  handle,
  widgetId,
  instanceId,
  enabled,
  label,
  getCardElement,
}: UseDraggableWidgetOptions) {
  const labelRef = useRef(label);
  const getCardElementRef = useRef(getCardElement);

  labelRef.current = label;
  getCardElementRef.current = getCardElement;

  useEffect(() => {
    if (!handle || !enabled) return;

    return draggable({
      element: handle,
      getInitialData: () => ({ type: DASHBOARD_WIDGET_DRAG_TYPE, instanceId, widgetId }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        const width = getCardElementRef.current()?.getBoundingClientRect().width ?? 240;

        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: pointerOutsideOfPreview({ x: '12px', y: '8px' }),
          render: ({ container }) => renderDragPreview(container, labelRef.current, width),
        });
      },
    });
  }, [enabled, handle, instanceId, widgetId]);
}

export interface WidgetDropIndicatorState {
  edge: WidgetDropEdge;
  blocked: boolean;
}

interface UseWidgetDropTargetOptions {
  elementRef: RefObject<HTMLElement>;
  widgetId: string;
  instanceId: symbol;
  enabled: boolean;
  getRows: () => DashboardRow[];
}

/** The left / right edges of a widget accept widgets into its row. */
export function useWidgetDropTarget({ elementRef, widgetId, instanceId, enabled, getRows }: UseWidgetDropTargetOptions) {
  const [indicator, setIndicator] = useState<WidgetDropIndicatorState | null>(null);
  const getRowsRef = useRef(getRows);

  getRowsRef.current = getRows;

  useEffect(() => {
    const element = elementRef.current;

    if (!element || !enabled) {
      setIndicator(null);
      return;
    }

    const update = (edge: WidgetDropEdge | null, sourceWidgetId: string) => {
      const feedback = edge
        ? getDropFeedback(getRowsRef.current(), sourceWidgetId, { type: 'widget', widgetId, edge })
        : 'noop';

      setIndicator((current) => {
        if (!edge || feedback === 'noop') return current === null ? current : null;
        const blocked = feedback === 'blocked';

        return current?.edge === edge && current.blocked === blocked ? current : { edge, blocked };
      });
    };

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isWidgetSource(source.data, instanceId) && source.data.widgetId !== widgetId,
      getData: ({ input }) =>
        attachClosestEdge(
          { type: DASHBOARD_WIDGET_DROP_TYPE, instanceId, widgetId },
          { element, input, allowedEdges: ['left', 'right'] }
        ),
      onDragEnter: ({ self, source }) => {
        update(extractClosestEdge(self.data) as WidgetDropEdge | null, String(source.data.widgetId));
      },
      onDrag: ({ self, source }) => {
        update(extractClosestEdge(self.data) as WidgetDropEdge | null, String(source.data.widgetId));
      },
      onDragLeave: () => setIndicator(null),
      onDrop: () => setIndicator(null),
    });
  }, [elementRef, enabled, instanceId, widgetId]);

  return indicator;
}

interface UseRowGapDropTargetOptions {
  elementRef: RefObject<HTMLElement>;
  rowIndex: number;
  instanceId: symbol;
  enabled: boolean;
  getRows: () => DashboardRow[];
}

/** A horizontal zone between rows that turns the dropped widget into a new row. */
export function useRowGapDropTarget({ elementRef, rowIndex, instanceId, enabled, getRows }: UseRowGapDropTargetOptions) {
  const [active, setActive] = useState(false);
  const getRowsRef = useRef(getRows);

  getRowsRef.current = getRows;

  useEffect(() => {
    const element = elementRef.current;

    if (!element || !enabled) {
      setActive(false);
      return;
    }

    return dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        isWidgetSource(source.data, instanceId) &&
        getDropFeedback(getRowsRef.current(), String(source.data.widgetId), { type: 'row-gap', rowIndex }) === 'allowed',
      getData: () => ({ type: DASHBOARD_ROW_GAP_DROP_TYPE, instanceId, rowIndex }),
      onDragEnter: () => setActive(true),
      onDragLeave: () => setActive(false),
      onDrop: () => setActive(false),
    });
  }, [elementRef, enabled, instanceId, rowIndex]);

  return active;
}
