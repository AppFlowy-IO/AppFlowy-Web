import { createContext, useContext } from 'react';

import { DashboardRow, DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { YDoc } from '@/application/types';

export type WidgetPickerRequest =
  | { mode: 'add'; placement: DashboardWidgetPlacement }
  | { mode: 'replace'; widgetId: string };

export type DashboardLimitReason = 'dashboard' | 'row';

/**
 * UI plumbing owned by the `Dashboard` component (picker, limit message,
 * drag-and-drop scope, source-doc reference counting). Separate from
 * `DashboardContext`, which also serves the tab bar outside the grid.
 */
export interface DashboardUiContextValue {
  openPicker: (request: WidgetPickerRequest) => void;
  showLimitMessage: (reason: DashboardLimitReason) => void;
  /** Scopes drag-and-drop to this dashboard instance. */
  dndInstanceId: symbol;
  /** Id of the widget being dragged, if any. */
  draggingWidgetId: string | null;
  /** Latest persisted rows, read at drop time. */
  getRows: () => DashboardRow[];
  /**
   * Expose a mounted widget's source doc to the global-filter editor. Returns
   * the release callback; the doc stays registered while any widget holds it.
   */
  acquireSourceDoc: (databaseId: string, doc: YDoc) => () => void;
}

export const DashboardUiContext = createContext<DashboardUiContextValue | null>(null);

export function useDashboardUi(): DashboardUiContextValue {
  const context = useContext(DashboardUiContext);

  if (!context) {
    throw new Error('DashboardUiContext is not provided');
  }

  return context;
}
