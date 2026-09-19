import { createContext, useContext } from 'react';

import type { DatabaseContextState } from '@/application/database-yjs/context';
import { DashboardRow, DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { YDoc } from '@/application/types';

export type WidgetPickerRequest =
  | { mode: 'add'; placement: DashboardWidgetPlacement }
  | { mode: 'replace'; widgetId: string };

export type DashboardLimitReason = 'dashboard' | 'row';

/**
 * UI plumbing owned by the `Dashboard` component (picker, limit message,
 * drag-and-drop scope, source-doc reference counting). Separate from
 * `DashboardContext`, which also serves the tab bar outside the grid. Every
 * entry is stable, so widgets reading it never re-render for layout changes.
 */
export interface DashboardUiContextValue {
  /** The host database id; widgets may reference other databases too. */
  hostDatabaseId: string;
  openPicker: (request: WidgetPickerRequest) => void;
  showLimitMessage: (reason: DashboardLimitReason) => void;
  /** Scopes drag-and-drop to this dashboard instance. */
  dndInstanceId: symbol;
  /** Latest persisted rows, read at call time. */
  getRows: () => DashboardRow[];
  /** Persist a row transformation computed from the latest rows. */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => void;
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

/** Id of the widget being dragged, if any. Kept apart: it changes on every drag start and drop. */
export const DashboardDraggingContext = createContext<string | null>(null);

export function useDashboardDraggingWidgetId(): string | null {
  return useContext(DashboardDraggingContext);
}

/**
 * The host database's app-level services that widgets forward to their nested
 * databases. The host `DatabaseContext` value also changes with its row map
 * and loading state; this subset only changes when a service does.
 */
export type DashboardHostServices = Pick<
  DatabaseContextState,
  | 'addPage'
  | 'bindViewSync'
  | 'canComment'
  | 'canShare'
  | 'canWrite'
  | 'checkIfRowDocumentExists'
  | 'createDatabaseView'
  | 'createRow'
  | 'createRowDocument'
  | 'databaseDoc'
  | 'deletePage'
  | 'duplicatePage'
  | 'duplicateRowDocument'
  | 'eventEmitter'
  | 'generateAISummaryForRow'
  | 'generateAITranslateForRow'
  | 'getViewIdFromDatabaseId'
  | 'loadDatabaseRelations'
  | 'loadRowDocument'
  | 'loadView'
  | 'loadViewMeta'
  | 'loadViews'
  | 'navigateToView'
  | 'openPageModal'
  | 'readOnly'
  | 'scheduleDeferredCleanup'
  | 'searchMentions'
  | 'updatePage'
  | 'uploadFile'
  | 'variant'
  | 'workspaceId'
>;

export const DashboardHostContext = createContext<DashboardHostServices | null>(null);

export function useDashboardHost(): DashboardHostServices {
  const context = useContext(DashboardHostContext);

  if (!context) {
    throw new Error('DashboardHostContext is not provided');
  }

  return context;
}
