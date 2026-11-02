import { useEffect, useMemo, useReducer } from 'react';

import { YDatabaseView, YDoc } from '@/application/types';

import { useDashboardFilters } from '../DashboardContext';

import { WidgetSourceIdentity } from './useWidgetSource';

interface UseWidgetOverlayViewOptions extends WidgetSourceIdentity {
  /** The open source doc, once it holds its database; `null` before. */
  doc: YDoc | null;
  /** The view as the source doc stores it. */
  realView: YDatabaseView | undefined;
  /** Published dashboards have no private conditions. */
  enabled: boolean;
}

/**
 * The viewer's own copy of the widget's filters and sorts. In View mode a
 * widget's conditions are local to the viewer (Notion keeps them so until
 * "Save for everybody"); Edit mode configures the real view.
 *
 * Resolved during render (the store is idempotent per widget id, like
 * `getDatabaseExternalStore`), so the nested database mounts with the overlay
 * instead of once without and once with it. The dashboard retains private
 * conditions across row moves and releases them only when the widget is
 * removed or points to another source.
 */
export function useWidgetOverlayView({
  widgetId,
  viewId,
  databaseId,
  doc,
  realView,
  enabled,
}: UseWidgetOverlayViewOptions) {
  const { getViewOverlay } = useDashboardFilters();
  const [overlayRevision, refreshOverlay] = useReducer((revision: number) => revision + 1, 0);
  const overlayView = useMemo(
    () => (enabled && doc ? getViewOverlay({ id: widgetId, databaseId, viewId }, realView) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlayRevision re-asks the store after a StrictMode remount
    [databaseId, doc, enabled, getViewOverlay, overlayRevision, realView, viewId, widgetId]
  );

  // StrictMode's simulated unmount clears the dashboard's store between this
  // render and the effects; take the store's fresh copy when it differs.
  useEffect(() => {
    if (!overlayView) return;
    const current = getViewOverlay({ id: widgetId, databaseId, viewId }, realView);

    if (current !== overlayView) refreshOverlay();
  }, [databaseId, getViewOverlay, overlayView, realView, viewId, widgetId]);

  return overlayView;
}
