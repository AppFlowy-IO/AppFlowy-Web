import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import {
  memo,
  MouseEvent,
  RefObject,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { DashboardWidget as DashboardWidgetData } from '@/application/database-yjs/dashboard.type';
import { cn } from '@/lib/utils';

import { DASHBOARD_COLUMN_GAP, DASHBOARD_MOTION_FAST_CLASS, WIDGET_BOX_PADDING } from './constants';
import { useDashboardSourceRegistry } from './DashboardContext';
import { useDashboardLimitText } from './DashboardLimitMessage';
import { useWidgetLoadStart } from './DashboardLoadScheduler';
import { useDashboardSelectedWidgetId, useDashboardUi } from './DashboardUiContext';
import { getDashboardFlexBasis } from './grid-layout';
import { useWidgetDropTarget } from './hooks/useDashboardDnd';
import { ROW_HEIGHT_CSS_VARIABLE, RowHeightPreview } from './hooks/useRowHeightResize';
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
  /** The height being dragged, if any (see `useRowHeightResize`). */
  heightPreview: RowHeightPreview;
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
 * Only the tint and the outline animate. The box takes a new width at once
 * (a resize, a wrap, a widget added or removed): animating `flex-basis` would
 * lay out the row and resize every nested database on each frame.
 */
export const DashboardWidget = memo(function DashboardWidget({
  widget,
  span,
  lineSize,
  height,
  heightPreview,
  isEditing,
  canEdit,
  showWidgetTitles,
  showIconsInHeading,
  isDragging,
}: DashboardWidgetProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { dndInstanceId, getRows } = useDashboardUi();
  const editing = isEditing && canEdit;
  const selected = useDashboardSelectedWidgetId() === widget.id && editing;
  const { menuOpen, settingsOpen, setMenuOpen, setSettingsOpen } = useWidgetLayers(widget.id, editing);
  const rowLimitText = useDashboardLimitText('row');
  // The box follows a row-height drag through CSS (the row's variable); the
  // nested database, whose viewport height derives from the number, catches
  // up when React has time instead of re-rendering on every pixel.
  const previewHeight = useSyncExternalStore(heightPreview.subscribe, heightPreview.get, heightPreview.get);
  const contentHeight = useDeferredValue(previewHeight ?? height);
  const indicator = useWidgetDropTarget({
    elementRef: cardRef,
    widgetId: widget.id,
    instanceId: dndInstanceId,
    enabled: editing,
    getRows,
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
      // below the dashboard's own chrome (handles, banners, drop indicators).
      // The outline is an inset shadow: drawn inside the box, never clipped.
      className={cn(
        'group/widget relative isolate flex min-w-0 flex-col rounded-500',
        'transition-[background-color,box-shadow] motion-reduce:transition-none',
        DASHBOARD_MOTION_FAST_CLASS,
        'data-[editing=true]:bg-dash-edit-tint data-[selected=true]:shadow-[inset_0_0_0_2px_var(--dash-accent)]'
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
        height: `var(${ROW_HEIGHT_CSS_VARIABLE})`,
        // `0 6 6` around the card; the header band replaces the top padding.
        padding: `${showWidgetTitles ? 0 : WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px ${WIDGET_BOX_PADDING}px`,
      }}
    >
      <div className={cn('relative flex h-full min-h-0 w-full flex-col transition-opacity', isDragging && 'opacity-40')}>
        <WidgetSource
          canEdit={canEdit}
          cardRef={cardRef}
          databaseId={widget.databaseId}
          isDragging={isDragging}
          isEditing={isEditing}
          key={`${widget.databaseId}:${widget.viewId}`}
          menuOpen={menuOpen}
          rowHeight={contentHeight}
          setMenuOpen={setMenuOpen}
          setSettingsOpen={setSettingsOpen}
          settingsOpen={settingsOpen}
          showIconsInHeading={showIconsInHeading}
          showWidgetTitles={showWidgetTitles}
          viewId={widget.viewId}
          widgetId={widget.id}
        />
      </div>
      {indicator ? (
        <DropIndicator
          appearance={indicator.blocked ? 'warning' : 'default'}
          edge={indicator.edge}
          gap={`${DASHBOARD_COLUMN_GAP}px`}
        />
      ) : null}
      {indicator?.blocked ? (
        <div
          className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-500 border border-border-warning-thick bg-fill-warning-light p-4 text-center text-sm font-medium text-text-primary'
          data-testid='dashboard-drop-not-allowed'
          role='status'
        >
          {rowLimitText}
        </div>
      ) : null}
    </div>
  );
});

export default DashboardWidget;
