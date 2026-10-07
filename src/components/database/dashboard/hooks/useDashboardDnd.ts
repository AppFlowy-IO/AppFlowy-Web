import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getDashboardDropFeedback,
  getDashboardDropIndicator,
  resolveDashboardDropPlacement,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardDropTarget, DashboardRow, DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { ViewLayout } from '@/application/types';

import {
  DASHBOARD_COLUMN_GAP,
  DASHBOARD_ROW_GAP_DROP_TYPE,
  DASHBOARD_WIDGET_DRAG_TYPE,
  DASHBOARD_WIDGET_DROP_TYPE,
  WIDGET_BOX_PADDING,
} from '../constants';
import { dashboardRowLimitAnnouncement } from '../DashboardFullTooltip';

import type { DragGhostStore, DropIndicatorStore } from '../arrange-stores';

export type WidgetDropEdge = 'left' | 'right';

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
    return { type: 'row_gap', rowIndex: data.rowIndex };
  }

  return null;
}

interface UseDashboardDndMonitorOptions {
  instanceId: symbol;
  enabled: boolean;
  getRows: () => DashboardRow[];
  onMove: (widgetId: string, placement: DashboardWidgetPlacement) => void;
  scrollContainerRef: RefObject<HTMLElement>;
  /** Tells assistive technology why a drop was refused. */
  announce: (message: string) => void;
  ghostStore: DragGhostStore;
  indicatorStore: DropIndicatorStore;
}

/**
 * Owns drops for one dashboard: moves the drag ghost with the pointer,
 * resolves the innermost target of a drop through the shared drop rules
 * (`getDashboardDropFeedback`: an allowed drop moves the widget, a blocked one
 * is announced, a no-op does nothing), auto-scrolls the dashboard while
 * dragging near its edges, and reports which widget is being dragged.
 */
export function useDashboardDndMonitor({
  instanceId,
  enabled,
  getRows,
  onMove,
  scrollContainerRef,
  announce,
  ghostStore,
  indicatorStore,
}: UseDashboardDndMonitorOptions) {
  const { t } = useTranslation();
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  const latest = useRef({ getRows, onMove, announce, t });

  latest.current = { getRows, onMove, announce, t };

  useEffect(() => {
    if (!enabled) {
      setDraggingWidgetId(null);
      ghostStore.clear();
      indicatorStore.clear();
      return;
    }

    const cleanups = [
      monitorForElements({
        canMonitor: ({ source }) => isWidgetSource(source.data, instanceId),
        onDragStart: ({ source }) => {
          setDraggingWidgetId(String(source.data.widgetId));
        },
        onDrag: ({ location }) => {
          ghostStore.move(location.current.input.clientX, location.current.input.clientY);
        },
        onDrop: ({ location, source }) => {
          setDraggingWidgetId(null);
          ghostStore.clear();
          indicatorStore.clear();
          // The innermost target may belong to the nested database (a board
          // column, a grid row); use the innermost dashboard target instead.
          const target = findDashboardDropTarget(
            location.current.dropTargets.map((dropTarget) => dropTarget.data),
            instanceId
          );

          if (!target) return;
          const widgetId = String(source.data.widgetId);
          const rows = latest.current.getRows();
          const feedback = getDashboardDropFeedback(rows, widgetId, target);

          if (feedback === 'blocked') {
            latest.current.announce(dashboardRowLimitAnnouncement(latest.current.t));
            return;
          }

          const placement = feedback === 'allowed' ? resolveDashboardDropPlacement(rows, widgetId, target) : null;

          if (placement) latest.current.onMove(widgetId, placement);
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
  }, [enabled, ghostStore, indicatorStore, instanceId, scrollContainerRef]);

  return draggingWidgetId;
}

interface UseDraggableWidgetOptions {
  handle: HTMLElement | null;
  widgetId: string;
  instanceId: symbol;
  enabled: boolean;
  /** Title and layout the drag ghost shows. */
  label: string;
  layout: ViewLayout;
  /** Returns the widget box, whose size the ghost takes. */
  getBoxElement: () => HTMLElement | null;
  ghostStore: DragGhostStore;
}

/**
 * Make the widget header a drag handle (Edit mode). The browser's drag image
 * is turned off: the dashboard draws its own ghost (`DashboardDragGhost`) at
 * the box's size, grabbed where the pointer went down.
 */
export function useDraggableWidget({
  handle,
  widgetId,
  instanceId,
  enabled,
  label,
  layout,
  getBoxElement,
  ghostStore,
}: UseDraggableWidgetOptions) {
  const latest = useRef({ label, layout, getBoxElement, ghostStore });

  latest.current = { label, layout, getBoxElement, ghostStore };

  useEffect(() => {
    if (!handle || !enabled) return;

    return draggable({
      element: handle,
      getInitialData: () => ({ type: DASHBOARD_WIDGET_DRAG_TYPE, instanceId, widgetId }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        disableNativeDragPreview({ nativeSetDragImage });
      },
      onDragStart: ({ location }) => {
        const current = latest.current;
        const box = current.getBoxElement()?.getBoundingClientRect();
        const { clientX, clientY } = location.initial.input;

        current.ghostStore.start(
          {
            widgetId,
            name: current.label,
            layout: current.layout,
            width: box?.width ?? 0,
            height: box?.height ?? 0,
            offsetX: box ? clientX - box.left : 0,
            offsetY: box ? clientY - box.top : 0,
          },
          clientX,
          clientY
        );
      },
    });
  }, [enabled, handle, instanceId, widgetId]);
}

interface UseWidgetDropTargetOptions {
  elementRef: RefObject<HTMLElement>;
  widgetId: string;
  instanceId: symbol;
  enabled: boolean;
  getRows: () => DashboardRow[];
  indicatorStore: DropIndicatorStore;
  /** Where the card starts inside the box: under the 40px header, or under the 6px padding without titles. */
  cardTop: number;
}

/** The centre of the gap next to a box: half the column gap outside its edge. */
const EDGE_GAP_CENTER = DASHBOARD_COLUMN_GAP / 2;

/**
 * The left / right edges of a widget accept widgets into its row. While a
 * widget is dragged over it, an allowed drop draws the row's vertical drop
 * line (`getDashboardDropIndicator`) in the centre of the gap at that edge,
 * over the card's height; a blocked or no-op target draws nothing.
 */
export function useWidgetDropTarget({
  elementRef,
  widgetId,
  instanceId,
  enabled,
  getRows,
  indicatorStore,
  cardTop,
}: UseWidgetDropTargetOptions) {
  const latest = useRef({ getRows, cardTop });

  latest.current = { getRows, cardTop };

  useEffect(() => {
    const element = elementRef.current;

    if (!element || !enabled) return;

    const update = (edge: WidgetDropEdge | null, sourceWidgetId: string) => {
      const indicator = edge
        ? getDashboardDropIndicator(latest.current.getRows(), sourceWidgetId, { type: 'widget', widgetId, edge })
        : null;
      const rowElement = element.closest<HTMLElement>("[data-testid='dashboard-row']");

      if (!edge || indicator?.type !== 'column' || !rowElement) {
        indicatorStore.clear(widgetId);
        return;
      }

      const box = element.getBoundingClientRect();
      const row = rowElement.getBoundingClientRect();
      const top = latest.current.cardTop;

      indicatorStore.set({
        widgetId,
        rowId: indicator.rowId,
        left: (edge === 'left' ? box.left - EDGE_GAP_CENTER : box.right + EDGE_GAP_CENTER) - row.left,
        top: box.top - row.top + top,
        height: box.height - top - WIDGET_BOX_PADDING,
      });
    };

    const cleanup = dropTargetForElements({
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
      onDragLeave: () => indicatorStore.clear(widgetId),
      onDrop: () => indicatorStore.clear(widgetId),
    });

    return () => {
      cleanup();
      indicatorStore.clear(widgetId);
    };
  }, [elementRef, enabled, indicatorStore, instanceId, widgetId]);
}

interface UseRowGapDropTargetOptions {
  elementRef: RefObject<HTMLElement>;
  rowIndex: number;
  instanceId: symbol;
  enabled: boolean;
  getRows: () => DashboardRow[];
}

/**
 * A horizontal zone between rows that turns the dropped widget into a new
 * row. It is a target only for a drop the shared rules allow, so a widget
 * alone in its row finds none right above or below that row (#15).
 */
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
        getDashboardDropFeedback(getRowsRef.current(), String(source.data.widgetId), { type: 'row_gap', rowIndex }) ===
          'allowed',
      getData: () => ({ type: DASHBOARD_ROW_GAP_DROP_TYPE, instanceId, rowIndex }),
      onDragEnter: () => setActive(true),
      onDragLeave: () => setActive(false),
      onDrop: () => setActive(false),
    });
  }, [elementRef, enabled, instanceId, rowIndex]);

  return active;
}
