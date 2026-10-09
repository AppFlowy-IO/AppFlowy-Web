import { createContext, useContext } from 'react';

import type { DatabaseContextState } from '@/application/database-yjs/context';
import { DashboardRow, DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';
import { YDoc } from '@/application/types';

import type { DashboardAddWidgetApi } from './add-widget/add-widget-api';
import type { DragGhostStore, DropIndicatorStore, RowMoveControlId } from './arrange-stores';
import type { OwnedWidgetViews } from './hooks/useOwnedWidgetViews';

/**
 * UI plumbing owned by the `Dashboard` component (the add flow, announcements,
 * drag-and-drop scope and feedback, source-doc reference counting). Separate
 * from `DashboardContext`, which also serves the tab bar outside the grid.
 * Every entry is stable (created once), so widgets reading it never re-render
 * for layout changes.
 */
export interface DashboardUiContextValue {
  /** The host database id; widgets may reference other databases too. */
  hostDatabaseId: string;
  /**
   * The add controls' entry point (the row "+", "Add to new row", the empty
   * dashboard's "+ New view"): inserts a selected default widget at
   * `placement` and opens the "New view" picker beside it (WP06 §1.1). A full
   * dashboard or row is refused with an announcement, never a banner, and
   * nothing is created.
   */
  startAddWidget: (placement: DashboardWidgetPlacement) => void;
  /** The add flow, the dock anchors and the docked panels' requests to widgets. */
  addWidget: DashboardAddWidgetApi;
  /** The views this dashboard owns (duplicate with a copy, rename, delete). */
  ownedViews: OwnedWidgetViews;
  /** Tells assistive technology (a polite live region); nothing shows on screen. */
  announce: (message: string) => void;
  /** Scopes drag-and-drop to this dashboard instance. */
  dndInstanceId: symbol;
  /** The vertical drop line of a widget drag (drawn by the row it belongs to). */
  dropIndicatorStore: DropIndicatorStore;
  /** The drag ghost (`DashboardDragGhost`). */
  dragGhostStore: DragGhostStore;
  /** Focus `control` of row `rowId` once the row renders at its new place (a row move). */
  requestRowFocus: (rowId: string, control: RowMoveControlId) => void;
  /** The pending focus request of `rowId`, taken. */
  consumeRowFocus: (rowId: string) => RowMoveControlId | null;
  /**
   * Set once the dashboard painted for the first time: widgets mounted later
   * (moved across rows, added) fade in, the first ones do not. Read at mount.
   */
  firstPaintDone: { readonly current: boolean };
  /** Latest persisted rows, read at call time. */
  getRows: () => DashboardRow[];
  /** Persist a row transformation computed from the latest rows; returns whether it wrote. */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => boolean;
  /**
   * Expose a mounted widget's source doc to the global-filter editor. Returns
   * the release callback; the doc stays registered while any widget holds it.
   */
  acquireSourceDoc: (databaseId: string, doc: YDoc) => () => void;
  /**
   * Select a widget (Edit mode only: its box shows the selection outline), or
   * clear the selection with `null`. With `onlyIf`, a clear only happens while
   * that widget is the one selected, so a closing menu never clears a newer
   * selection. UI state: never persisted.
   */
  selectWidget: (id: string | null, options?: { onlyIf?: string }) => void;
}

export const DashboardUiContext = createContext<DashboardUiContextValue | null>(null);

/** The dashboard UI plumbing, or `null` outside a dashboard (a widget rendered on its own). */
export function useDashboardUiOptional(): DashboardUiContextValue | null {
  return useContext(DashboardUiContext);
}

export function useDashboardUi(): DashboardUiContextValue {
  const context = useContext(DashboardUiContext);

  if (!context) {
    throw new Error('DashboardUiContext is not provided');
  }

  return context;
}

/** Id of the selected widget, always `null` outside Edit mode. Kept apart: it changes with every menu and settings host. */
export const DashboardSelectionContext = createContext<string | null>(null);

export function useDashboardSelectedWidgetId(): string | null {
  return useContext(DashboardSelectionContext);
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
 *
 * `createRow` and `getSubscriptions` are the app's own where the app provides
 * them (`useDashboardHostServices`): the host database wraps `createRow` for
 * its own rows, and a widget's layout switcher asks the workspace plan
 * through `getSubscriptions` before it offers Timeline.
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
  | 'getSubscriptions'
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
