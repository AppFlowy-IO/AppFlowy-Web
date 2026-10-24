import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

import { useWidgetContextOptional } from '../WidgetContext';

/**
 * A dashboard widget's private (unsaved) filter and sort state, for the
 * Filter / Sort tool dots and the popover footers (WP07). A tiny module with
 * no dashboard imports beyond the widget context, so generic database code
 * (`FiltersButton`, `SortsButton`) can read it; outside a dashboard every
 * hook returns `null`.
 */
export interface WidgetPrivateSnapshot {
  /** The widget's filters differ from its saved view. */
  filters: boolean;
  /** The widget's sorts differ from its saved view. */
  sorts: boolean;
  /** "Save for everyone" is offered: dashboard write access and a writable source. */
  canSave: boolean;
  /** Edit mode shows the saved conditions: no dot and no footer. */
  suspended: boolean;
}

export interface WidgetPrivateHandle {
  subscribe: (listener: () => void) => () => void;
  /** Stable until a part, the source's writability or the mode changes. */
  getSnapshot: () => WidgetPrivateSnapshot;
  /** Drop this widget's private filters and sorts. */
  reset: () => void;
  /** Save this widget's private filters and sorts for everyone (one undo step). */
  save: () => void;
}

export interface WidgetIdentity {
  id: string;
  databaseId: string;
  viewId: string;
}

/** Provided by `DashboardProvider`: resolves a widget's handle (stable per widget). */
export interface WidgetPrivateResolver {
  getWidgetPrivateHandle: (widget: WidgetIdentity) => WidgetPrivateHandle;
}

export const WidgetPrivateContext = createContext<WidgetPrivateResolver | null>(null);

/** The private-state handle of the widget the caller renders in; `null` outside a dashboard widget. */
export function useWidgetPrivateHandle(): WidgetPrivateHandle | null {
  const widget = useWidgetContextOptional();
  const resolver = useContext(WidgetPrivateContext);
  const widgetId = widget?.widgetId;
  const databaseId = widget?.databaseId;
  const viewId = widget?.viewId;

  return useMemo(
    () =>
      resolver && widgetId && databaseId && viewId
        ? resolver.getWidgetPrivateHandle({ id: widgetId, databaseId, viewId })
        : null,
    [databaseId, resolver, viewId, widgetId]
  );
}

const noopSubscribe = () => () => undefined;
const noSnapshot = () => null;

/** The widget's private-state snapshot; `null` outside a dashboard widget. */
export function useWidgetPrivateSnapshot(): WidgetPrivateSnapshot | null {
  const handle = useWidgetPrivateHandle();

  return useSyncExternalStore(
    handle ? handle.subscribe : noopSubscribe,
    handle ? handle.getSnapshot : noSnapshot,
    handle ? handle.getSnapshot : noSnapshot
  );
}
