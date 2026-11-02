import {
  CSSProperties,
  memo,
  MouseEvent,
  RefObject,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { DashboardWidget as DashboardWidgetData } from '@/application/database-yjs/dashboard.type';
import { ChartResizingContext } from '@/components/database/chart/widgets/useReducedMotion';
import { cn } from '@/lib/utils';

import { DASHBOARD_WIDGET_BOX_TRANSITION_CLASS, WIDGET_BOX_PADDING, WIDGET_HEADER_HEIGHT } from './constants';
import { useDashboardContextOptional, useDashboardSourceRegistry } from './DashboardContext';
import { useWidgetLoadStart } from './DashboardLoadScheduler';
import { useDashboardSelectedWidgetId, useDashboardUi } from './DashboardUiContext';
import { getDashboardFlexBasis } from './grid-layout';
import { useWidgetDropTarget } from './hooks/useDashboardDnd';
import { RowHeightPreview } from './hooks/useRowHeightResize';
import { useWidgetActions } from './hooks/useWidgetActions';
import { useWidgetLayers } from './hooks/useWidgetLayers';
import { useWidgetViewMeta } from './hooks/useWidgetViewMeta';
import { getWidgetHeaderHeight, getWidgetViewportHeight } from './utils';
import { WidgetFrame } from './WidgetContext';
import { WidgetDatabaseHost } from './WidgetDatabaseHost';
import { WidgetContextProvider, WidgetPlaceholderFrame } from './WidgetFrame';

interface WidgetChromeProps {
  isEditing: boolean;
  canEdit: boolean;
  showWidgetTitles: boolean;
  showIconsInHeading: boolean;
  isDragging: boolean;
}

interface WidgetSourceProps extends WidgetChromeProps {
  // The ids rather than the widget object: a resize or move re-creates the
  // object, and the source has no use for the width.
  widgetId: string;
  /** A phone or a web viewport below 768px (WP14 §1.4). */
  mobileContext: boolean;
  viewId: string;
  databaseId: string;
  rowHeight: number;
  cardRef: RefObject<HTMLDivElement>;
  /** The widget menu and the settings host (`useWidgetLayers`, owned by the box). */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

/**
 * The frame of a widget: everything its header, menu and settings host need
 * that does not depend on the source database (the view's folder name and
 * icon, the mode, the menu actions). `WidgetDatabaseHost` loads the source
 * and renders it, or the frame's placeholder, inside this frame.
 *
 * The dashboard's load queue decides when the host mounts
 * (`useWidgetLoadStart`): until then the widget shows its header and the
 * loading placeholder and loads nothing. The host reports its load back, which
 * frees the source's slot for the next widget in the queue.
 *
 * It owns the mobile search state (WP14 §1.4.5): the Search tool expands the
 * field over the title, and leaving the mobile context collapses it.
 *
 * Keyed by view + database so switching the view resets the source. Reads
 * only stable dashboard contexts: layout changes elsewhere on the dashboard
 * never re-render it.
 */
const WidgetSource = memo(function WidgetSource({
  widgetId,
  viewId,
  databaseId,
  rowHeight,
  cardRef,
  menuOpen,
  setMenuOpen,
  settingsOpen,
  setSettingsOpen,
  isDragging,
  isEditing,
  canEdit,
  showWidgetTitles,
  showIconsInHeading,
  mobileContext,
}: WidgetSourceProps) {
  const meta = useWidgetViewMeta(viewId);
  const { getShownDoc } = useDashboardSourceRegistry();
  // A widget that remounts after a move and showed its view before resumes at once.
  const [resume] = useState(() => getShownDoc(widgetId, viewId) !== null);
  const load = useWidgetLoadStart({ widgetId, sourceId: databaseId, boxRef: cardRef, resume });
  const editing = isEditing && canEdit;
  const titleRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const settingsToolRef = useRef<HTMLButtonElement>(null);
  const getBoxElement = useCallback(() => cardRef.current, [cardRef]);
  const openSettings = useCallback(() => setSettingsOpen(true), [setSettingsOpen]);
  const actions = useWidgetActions({ widgetId, viewId, databaseId, openSettings });
  const chrome = { showWidgetTitles };
  const headerHeight = getWidgetHeaderHeight(chrome);
  const [searchActive, setSearchActive] = useState(false);

  // A wider window is no mobile context: the desktop search control takes over
  // (it opens on a query that is still set).
  if (searchActive && !mobileContext) setSearchActive(false);

  const frame = useMemo<WidgetFrame>(
    () => ({
      widgetId,
      databaseId,
      viewId,
      folderName: meta.name,
      folderLayout: meta.layout,
      icon: meta.icon,
      isEditing,
      canEdit,
      editing,
      mobileContext,
      searchActive,
      setSearchActive,
      showWidgetTitles,
      showIcon: showIconsInHeading,
      headerHeight,
      isDragging,
      menuOpen,
      setMenuOpen,
      settingsOpen,
      setSettingsOpen,
      getBoxElement,
      titleRef,
      optionsRef,
      settingsToolRef,
      actions,
    }),
    [
      actions,
      canEdit,
      databaseId,
      editing,
      getBoxElement,
      headerHeight,
      isDragging,
      isEditing,
      menuOpen,
      meta.icon,
      meta.layout,
      meta.name,
      mobileContext,
      searchActive,
      setMenuOpen,
      setSettingsOpen,
      settingsOpen,
      showIconsInHeading,
      showWidgetTitles,
      viewId,
      widgetId,
    ]
  );

  if (!load.started) {
    return (
      <WidgetContextProvider frame={frame} sourceView={null}>
        <WidgetPlaceholderFrame reason='loading' />
      </WidgetContextProvider>
    );
  }

  return (
    <WidgetDatabaseHost
      frame={frame}
      onLoadStateChange={load.report}
      viewportHeight={getWidgetViewportHeight(rowHeight, chrome)}
    />
  );
});

interface DashboardWidgetProps extends WidgetChromeProps {
  widget: DashboardWidgetData;
  /** Columns the box spans on its line: the stored width, or an equal share when the row wraps. */
  span: number;
  /** Widgets on the box's line (the flex basis subtracts their gaps). */
  lineSize: number;
  /** Persisted row height in CSS px. */
  height: number;
  /** The height being dragged, if any (see `useRowHeightResize`): the box only reads whether a drag runs. */
  heightPreview: RowHeightPreview;
  /** A width handle of the row is being dragged. */
  widthResizing?: boolean;
}

const FLEX_BASIS = 'flex-basis';

/**
 * Whether the box is easing to a new width (the 200ms flex-basis transition
 * of an arrange operation). Hand resizing and reduced motion have none.
 */
function useFlexBasisTransition(boxRef: RefObject<HTMLElement>) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const box = boxRef.current;

    if (!box) return;
    const update = (value: boolean) => (event: TransitionEvent) => {
      if (event.target === box && event.propertyName === FLEX_BASIS) setRunning(value);
    };

    const start = update(true);
    const end = update(false);

    box.addEventListener('transitionrun', start);
    box.addEventListener('transitionend', end);
    box.addEventListener('transitioncancel', end);
    return () => {
      box.removeEventListener('transitionrun', start);
      box.removeEventListener('transitionend', end);
      box.removeEventListener('transitioncancel', end);
    };
  }, [boxRef]);

  return running;
}

/**
 * Hands committed row heights to the widgets' content one widget per
 * animation frame, as transitions: each nested database lays out in a frame
 * of its own instead of all of them in the frame of the commit.
 */
const contentHeightQueue = (() => {
  const waiting: (() => void)[] = [];
  let frame: number | null = null;
  const releaseNext = () => {
    frame = null;
    waiting.shift()?.();
    if (waiting.length > 0) frame = requestAnimationFrame(releaseNext);
  };

  return {
    /** Queues `release`; returns the cancel. */
    enqueue(release: () => void) {
      waiting.push(release);
      if (frame === null) frame = requestAnimationFrame(releaseNext);
      return () => {
        const index = waiting.indexOf(release);

        if (index !== -1) waiting.splice(index, 1);
      };
    },
  };
})();

/** The height the content lays out at: `height`, a frame or a few after it changes (`contentHeightQueue`). */
function useContentHeight(height: number) {
  const [contentHeight, setContentHeight] = useState(height);

  useEffect(() => {
    if (contentHeight === height) return;
    return contentHeightQueue.enqueue(() => startTransition(() => setContentHeight(height)));
  }, [contentHeight, height]);

  return contentHeight;
}

/** Whether the row's height handle is being dragged: renders on the drag's start and end only. */
function useHeightDragging(preview: RowHeightPreview) {
  const getDragging = useCallback(() => preview.get() !== null, [preview]);

  return useSyncExternalStore(preview.subscribe, getDragging, getDragging);
}

/** Editable targets keep the browser's own context menu. */
function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
  );
}

/**
 * One widget box: its place in the row track, the Edit-mode tint and
 * selection outline (colors only, never a size change), the drop target for
 * widgets dragged next to it, and the source view inside (header and card).
 * A right-click anywhere on the box opens the widget menu, unless the content
 * handles the context menu itself.
 *
 * Motion (WP04 §2.5): the tint and the outline animate, the box fades to 40%
 * while it is dragged, and a width an arrange operation changes (a row split
 * equally after an add, a removal or a move) eases over 200ms. Nothing
 * animates while the row is resized by hand or when reduced motion is asked
 * for. A box mounted into a row after the dashboard's first paint (moved from
 * another row, added) fades in.
 *
 * Resizing (W10, W21; the same rule as desktop): the row writes the box height
 * (`useRowHeightResize`). During a height drag the box follows the pointer at
 * each 20px step while its content keeps the height it had before the drag,
 * top-aligned and clipped by the box, never scaled; the content takes the new
 * height once, in one step, a frame after pointer up or a keyboard step (one
 * widget per frame, so no frame lays out every nested database), and stays
 * held until then. During a width drag the content lays out again only when
 * the snapped widths change. Charts inside draw without animation while the
 * row is resized or the box eases to a new width (`ChartResizingContext`).
 */
export const DashboardWidget = memo(function DashboardWidget({
  widget,
  span,
  lineSize,
  height,
  heightPreview,
  widthResizing = false,
  isEditing,
  canEdit,
  showWidgetTitles,
  showIconsInHeading,
  isDragging,
}: DashboardWidgetProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { dndInstanceId, getRows, dropIndicatorStore, firstPaintDone, addWidget } = useDashboardUi();
  const mobileContext = useDashboardContextOptional()?.mobileContext ?? false;
  const editing = isEditing && canEdit;
  const selected = useDashboardSelectedWidgetId() === widget.id && editing;
  const { menuOpen, settingsOpen, setMenuOpen, setSettingsOpen } = useWidgetLayers(widget.id, editing);
  const { dockAnchors, settingsRequest } = addWidget;
  const widgetId = widget.id;
  // The docked panels (picker, New view panel, Source) open beside this corner.
  const registerDockAnchor = useMemo(() => dockAnchors.anchorRef(widgetId), [dockAnchors, widgetId]);
  // "Edit chart" and the Source panel's back open this widget's settings host.
  const request = useSyncExternalStore(settingsRequest.subscribe, settingsRequest.get, settingsRequest.get);
  const handledRequestRef = useRef(request?.seq ?? 0);

  useEffect(() => {
    if (!request || request.seq === handledRequestRef.current) return;
    handledRequestRef.current = request.seq;
    if (request.widgetId === widgetId && editing) setSettingsOpen(true);
  }, [editing, request, setSettingsOpen, widgetId]);
  // Arrange operations only happen in Edit mode; read once, at mount.
  const [fadeIn] = useState(() => editing && firstPaintDone.current);
  // The first paint's height; the row's resize hook writes it from then on.
  const [initialHeight] = useState(() => heightPreview.get() ?? height);
  const heightDragging = useHeightDragging(heightPreview);
  // The content takes a committed height after the commit's frame, one widget per frame, while
  // the box already shows it.
  const contentHeight = useContentHeight(height);
  const easingWidth = useFlexBasisTransition(cardRef);
  // The end of a width drag reaches the charts in a deferred render, not in the pointer up.
  const widthSettling = useDeferredValue(widthResizing);
  // Up from a drag's start until the content has its new height. A chart that saw it stays still
  // until its data changes (`useChartAnimation`), so the size change that follows the release
  // does not animate either.
  const chartResizing = heightDragging || widthResizing || widthSettling || easingWidth || contentHeight !== height;
  const paddingTop = showWidgetTitles ? 0 : WIDGET_BOX_PADDING;
  // The content keeps the height it lays out at while the box follows a drag, and after a commit
  // until its frame hands it the new height (`contentHeight`): top-aligned, clipped by the box.
  // Releasing it earlier would stretch or spill it around a nested database still at its old
  // height, and resize a chart (it fills the content) in the commit's frame.
  const contentHeld = heightDragging || contentHeight !== height;
  const heldContentStyle: CSSProperties | undefined = contentHeld
    ? { height: contentHeight - paddingTop - WIDGET_BOX_PADDING, flexShrink: 0 }
    : undefined;

  useWidgetDropTarget({
    elementRef: cardRef,
    widgetId: widget.id,
    instanceId: dndInstanceId,
    enabled: editing,
    getRows,
    indicatorStore: dropIndicatorStore,
    cardTop: showWidgetTitles ? WIDGET_HEADER_HEIGHT : WIDGET_BOX_PADDING,
  });
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      event.preventDefault();
      setMenuOpen(true);
    },
    [setMenuOpen]
  );

  return (
    <div
      // `isolate` keeps the nested database's z-indexes (sticky headers, …)
      // below the dashboard's own chrome (handles, row controls, drop lines).
      // The outline is an inset shadow: drawn inside the box, never clipped.
      className={cn(
        'group/widget relative isolate flex min-w-0 flex-col rounded-500',
        DASHBOARD_WIDGET_BOX_TRANSITION_CLASS,
        'group-data-[resizing=true]/row:transition-none motion-reduce:transition-none',
        'data-[editing=true]:bg-dash-edit-tint data-[selected=true]:shadow-[inset_0_0_0_2px_var(--dash-accent)]',
        isDragging && 'opacity-40'
      )}
      data-database-id={widget.databaseId}
      data-dragging={isDragging ? 'true' : undefined}
      data-editing={editing ? 'true' : 'false'}
      data-parity-id='dash-widget-box'
      data-selected={selected ? 'true' : undefined}
      data-testid='dashboard-widget'
      data-view-id={widget.viewId}
      data-widget-id={widget.id}
      onContextMenu={handleContextMenu}
      ref={cardRef}
      style={{
        flex: `1 1 ${getDashboardFlexBasis(span, lineSize)}`,
        height: initialHeight,
        // `0 6 6` around the card; the header band replaces the top padding.
        padding: `${paddingTop}px ${WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px`,
        // `clip`, not `hidden`: no scroll container, so focus never scrolls the held content.
        overflow: contentHeld ? 'clip' : undefined,
      }}
    >
      <div
        className={cn(
          'relative flex h-full min-h-0 w-full flex-col',
          fadeIn && 'animate-in fade-in-0 [animation-duration:var(--dash-motion-reflow)] motion-reduce:animate-none'
        )}
        data-content-held={contentHeld ? 'true' : undefined}
        data-fade-in={fadeIn ? 'true' : undefined}
        style={heldContentStyle}
      >
        <ChartResizingContext.Provider value={chartResizing}>
          <WidgetSource
            canEdit={canEdit}
            cardRef={cardRef}
            databaseId={widget.databaseId}
            isDragging={isDragging}
            isEditing={isEditing}
            key={`${widget.databaseId}:${widget.viewId}`}
            menuOpen={menuOpen}
            mobileContext={mobileContext}
            rowHeight={contentHeight}
            setMenuOpen={setMenuOpen}
            setSettingsOpen={setSettingsOpen}
            settingsOpen={settingsOpen}
            showIconsInHeading={showIconsInHeading}
            showWidgetTitles={showWidgetTitles}
            viewId={widget.viewId}
            widgetId={widget.id}
          />
        </ChartResizingContext.Provider>
      </div>
      <span
        aria-hidden='true'
        className='pointer-events-none absolute right-0 top-0 h-0 w-0'
        data-dock-anchor='true'
        ref={registerDockAnchor}
      />
    </div>
  );
});

export default DashboardWidget;
