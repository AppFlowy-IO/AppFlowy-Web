import * as Y from 'yjs';

import {
  DatabaseViewLayout,
  RowId,
  View,
  ViewLayout,
  YDatabase,
  YDatabaseRowOrders,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { assertDashboardViewCreationOnline } from '@/application/view-online-policy';
import { isDatabaseContainer, isEmbeddedDatabaseViewWithoutChildren, isEmbeddedView } from '@/application/view-utils';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';

import { seedDashboardLayoutSetting } from './dashboard-layout';
import { DASHBOARD_OWNER_KEY, readDashboardOwner } from './dashboard-owned-views';
import { assertDatabaseViewCapacity } from './database-view-capacity';
import { normalizeCreatedDatabaseFeedView, updateCreatesExactFeedView } from './feed-layout';
import {
  normalizeCreatedDatabaseGalleryView,
  updateCreatesExactGalleryView as updateCreatesExactDatabaseView,
} from './gallery-layout';
import { executeDatabaseOperations as executeOperations } from './history';
import { normalizeCreatedDatabaseListView, removeCreatedDatabaseView } from './list-layout';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from './row-order-visibility';

import type { DatabaseContextState } from './context';

/**
 * Operations on the views of a database document that need no React hook: the
 * bodies of the tab hooks in `dispatch.ts` and the building blocks of the
 * dashboard operations in `dashboard-owned-view-ops.ts`. Both import this
 * module; it imports neither.
 */

/**
 * Options of a new database view (a tab of the database).
 */
export interface AddDatabaseViewOptions {
  /** Place the new folder child immediately before this existing database view. */
  insertBeforeViewId?: string;
  /** Validate the returned child in an isolated Y.Doc before applying its update. */
  requireExactCreatedView?: boolean;
  /**
   * The dashboard view that owns the new view (WP05 §1.1). The collab mirror
   * is written at once, so the view never shows up as a database tab, and the
   * folder extra right after (see `markDashboardOwnedView`).
   */
  dashboardOwner?: string;
  /**
   * `false` writes only the collab mirror of `dashboardOwner`: the caller
   * writes the folder markers of all its copies together (a dashboard
   * duplicate). Default `true`.
   */
  writeDashboardOwnerToFolder?: boolean;
}

export const FORM_VIEW_CREATION_REQUIRES_WRITE_PERMISSION =
  'Edit access is required to create or duplicate a Form view.';

/**
 * What the database view operations below read from a database context. The
 * hooks pass their own context; dashboard code passes another database's doc
 * (a widget source) and can run after the component that started it unmounts.
 */
export type DatabaseViewDocDeps = Pick<DatabaseContextState, 'databaseDoc' | 'databasePageId'> &
  Partial<
    Pick<
      DatabaseContextState,
      | 'activeViewId'
      | 'bindViewSync'
      | 'canWrite'
      | 'createDatabaseView'
      | 'deletePage'
      | 'isDocumentBlock'
      | 'loadView'
      | 'loadViewMeta'
      | 'readOnly'
      | 'scheduleDeferredCleanup'
      | 'updatePage'
    >
  >;

/** The database of a database document, or `undefined` while the doc holds none. */
export function getDatabaseFromDoc(databaseDoc: YDoc | undefined) {
  return databaseDoc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase | undefined;
}

function getSharedRoot(databaseDoc: YDoc) {
  return databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
}

// ---------------------------------------------------------------------------
// Dashboard owner marker (WP05 §1.1)
// ---------------------------------------------------------------------------

/**
 * The folder write of an owner marker is retried after these waits (ms). After
 * the last one fails the marker stays in the collab mirror only, until the
 * dashboard's next open repairs it (`repairDashboardOwnerMarkers`).
 */
export const DASHBOARD_OWNER_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 4000];

export type DashboardOwnerMarkerDeps = Pick<DatabaseViewDocDeps, 'databaseDoc' | 'loadViewMeta' | 'updatePage'>;

export interface DashboardOwnerWriteOptions {
  retryDelaysMs?: readonly number[];
  /** Test seam for the waits between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

export interface DashboardOwnerMark {
  /** Whether the first folder attempt left the marker in place. */
  folderWritten: boolean;
  /**
   * Settles when the detached retries end: whether the folder copy is in
   * place. Already settled when the first attempt succeeded. Never rejects.
   */
  settled: Promise<boolean>;
}

type FolderOwnerAttempt = { ok: true } | { ok: false; error: unknown };

/** The folder calls of a marker write, both present. */
type FolderOwnerDeps = Required<Pick<DashboardOwnerMarkerDeps, 'loadViewMeta' | 'updatePage'>>;

function folderOwnerDeps(deps: Pick<DashboardOwnerMarkerDeps, 'loadViewMeta' | 'updatePage'>): FolderOwnerDeps | null {
  const { loadViewMeta, updatePage } = deps;

  return loadViewMeta && updatePage ? { loadViewMeta, updatePage } : null;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function hasCollabView(doc: YDoc, viewId: string) {
  return getDatabaseFromDoc(doc)?.get(YjsDatabaseKey.views)?.has(viewId) === true;
}

/**
 * Write `owner` on the collab mirror of `viewId` (not an undo step). Returns
 * whether the view is in the collab.
 */
export function writeCollabDashboardOwner(doc: YDoc, viewId: string, owner: string): boolean {
  const view = getDatabaseFromDoc(doc)?.get(YjsDatabaseKey.views)?.get(viewId);

  if (!view) return false;
  if (view.get(DASHBOARD_OWNER_KEY) === owner) return true;
  executeOperations(getSharedRoot(doc), [() => view.set(DASHBOARD_OWNER_KEY, owner)], 'markDashboardOwnedView', {
    type: 'view.dashboard-owner',
    policy: 'skip',
  });
  return true;
}

/**
 * One attempt to write `owner` into the folder view's `extra`. The server
 * replaces `extra` and refuses a payload that drops its own keys, so the
 * attempt re-reads the fresh meta and merges into it: unknown keys survive.
 */
async function attemptFolderDashboardOwner(
  folder: FolderOwnerDeps,
  viewId: string,
  owner: string
): Promise<FolderOwnerAttempt> {
  try {
    const meta = await folder.loadViewMeta(viewId, undefined, { authoritative: true });

    if (!meta) throw new Error('View not found');
    if (readDashboardOwner(meta) !== owner) {
      await folder.updatePage(viewId, {
        name: meta.name,
        icon: meta.icon ?? undefined,
        extra: { ...(meta.extra ?? {}), dashboard_owner: owner },
      });
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * The attempts after a failed first one. Stops, without a warning, once
 * `isViewGone` says the view left the collab (a rolled-back copy has nothing
 * left to mark). Never rejects.
 */
async function retryFolderDashboardOwner(
  folder: FolderOwnerDeps,
  viewId: string,
  owner: string,
  firstError: unknown,
  options: DashboardOwnerWriteOptions & { isViewGone?: () => boolean }
): Promise<boolean> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError = firstError;

  try {
    for (const delay of options.retryDelaysMs ?? DASHBOARD_OWNER_RETRY_DELAYS_MS) {
      await sleep(delay);
      if (options.isViewGone?.()) return false;
      const attempt = await attemptFolderDashboardOwner(folder, viewId, owner);

      if (attempt.ok) return true;
      lastError = attempt.error;
    }
  } catch (error) {
    lastError = error;
  }

  // The collab mirror keeps hiding the view from the tab bars of its database.
  Log.warn('[Dashboard] failed to write the owner marker to the folder', { viewId, owner, error: lastError });
  return false;
}

/**
 * Write the folder copy of an owner marker and wait for every retry. For a
 * background pass; a user action goes through `markDashboardOwnedView`. Never
 * throws; resolves to whether the folder copy is in place.
 */
export async function writeFolderDashboardOwner(
  deps: Pick<DashboardOwnerMarkerDeps, 'loadViewMeta' | 'updatePage'>,
  viewId: string,
  owner: string,
  options: DashboardOwnerWriteOptions = {}
): Promise<boolean> {
  const folder = folderOwnerDeps(deps);

  if (!folder) return false;
  const first = await attemptFolderDashboardOwner(folder, viewId, owner);

  return first.ok || retryFolderDashboardOwner(folder, viewId, owner, first.error, options);
}

/**
 * Mark `viewId` as owned by the dashboard view `owner` (WP05 §1.1): the collab
 * mirror first, synchronously, so local tab bars hide the view at once; then
 * one attempt at the authoritative folder extra. The promise resolves after
 * that attempt. When it failed, the retries run detached (`settled`) and stop
 * once the view is gone from the collab. Never throws.
 */
export async function markDashboardOwnedView(
  deps: DashboardOwnerMarkerDeps,
  viewId: string,
  owner: string,
  options: DashboardOwnerWriteOptions = {}
): Promise<DashboardOwnerMark> {
  const inCollab = writeCollabDashboardOwner(deps.databaseDoc, viewId, owner);
  const folder = folderOwnerDeps(deps);

  if (!folder) return { folderWritten: false, settled: Promise.resolve(false) };
  const first = await attemptFolderDashboardOwner(folder, viewId, owner);

  if (first.ok) return { folderWritten: true, settled: Promise.resolve(true) };
  return {
    folderWritten: false,
    settled: retryFolderDashboardOwner(folder, viewId, owner, first.error, {
      ...options,
      // A view that never reached the collab cannot be told apart from a deleted one.
      isViewGone: () => inCollab && !hasCollabView(deps.databaseDoc, viewId),
    }),
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT: Record<DatabaseViewLayout, ViewLayout> = {
  [DatabaseViewLayout.Grid]: ViewLayout.Grid,
  [DatabaseViewLayout.Board]: ViewLayout.Board,
  [DatabaseViewLayout.Calendar]: ViewLayout.Calendar,
  [DatabaseViewLayout.Chart]: ViewLayout.Chart,
  [DatabaseViewLayout.List]: ViewLayout.List,
  [DatabaseViewLayout.Gallery]: ViewLayout.Gallery,
  [DatabaseViewLayout.Feed]: ViewLayout.Feed,
  [DatabaseViewLayout.Form]: ViewLayout.Form,
  [DatabaseViewLayout.Timeline]: ViewLayout.Timeline,
  [DatabaseViewLayout.Dashboard]: ViewLayout.Dashboard,
};

/** The name a new view of each layout gets, and the fallback name of an unnamed tab. */
export const DATABASE_VIEW_LAYOUT_DEFAULT_NAMES: Record<DatabaseViewLayout, string> = {
  [DatabaseViewLayout.Grid]: 'Grid',
  [DatabaseViewLayout.Board]: 'Board',
  [DatabaseViewLayout.Calendar]: 'Calendar',
  [DatabaseViewLayout.Chart]: 'Chart',
  [DatabaseViewLayout.List]: 'List',
  [DatabaseViewLayout.Gallery]: 'Gallery',
  [DatabaseViewLayout.Feed]: 'Feed',
  [DatabaseViewLayout.Form]: 'Form builder',
  [DatabaseViewLayout.Timeline]: 'Timeline',
  [DatabaseViewLayout.Dashboard]: 'Dashboard',
};

/**
 * Create a view of the database in `deps.databaseDoc` as a child of its
 * container (or of the document, for an embedded database without one) and
 * return its id. The body of `useAddDatabaseView`, usable without a hook.
 */
export async function createDatabaseViewInDoc(
  deps: DatabaseViewDocDeps,
  layout: DatabaseViewLayout,
  nameOverride?: string,
  options?: AddDatabaseViewOptions
): Promise<string> {
  if (options?.dashboardOwner) assertDashboardViewCreationOnline();
  assertDatabaseViewCapacity(deps.databaseDoc);
  // databasePageId: The main database page in folder (used as parent for new views)
  const {
    databasePageId,
    activeViewId,
    createDatabaseView,
    databaseDoc,
    deletePage,
    loadViewMeta,
    updatePage,
    isDocumentBlock,
    readOnly,
    canWrite,
  } = deps;
  const database = getDatabaseFromDoc(databaseDoc);
  const databaseId = database?.get(YjsDatabaseKey.id);

  if (layout === DatabaseViewLayout.Form && (readOnly || canWrite === false)) {
    throw new Error(FORM_VIEW_CREATION_REQUIRES_WRITE_PERMISSION);
  }

  if (!createDatabaseView) {
    throw new Error('createDatabaseView not found');
  }

  if (!databasePageId) {
    throw new Error('databasePageId not found');
  }

  const requestViewId = activeViewId || databasePageId;

  if (!databaseId) {
    throw new Error('databaseId not found');
  }

  const viewLayout = DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT[layout];
  const name = DATABASE_VIEW_LAYOUT_DEFAULT_NAMES[layout];

  const getLastChildViewId = (view: View | null | undefined): string | undefined => {
    const children = view?.children ?? [];

    return children.length > 0 ? children[children.length - 1].view_id : undefined;
  };

  const getInsertionPrevViewId = (view: View | null | undefined, fallbackViewId?: string): string | undefined => {
    const insertBeforeViewId = options?.insertBeforeViewId;
    const children = view?.children ?? [];

    if (insertBeforeViewId) {
      const insertBeforeIndex = children.findIndex((child) => child.view_id === insertBeforeViewId);

      if (insertBeforeIndex >= 0) {
        return insertBeforeIndex > 0 ? children[insertBeforeIndex - 1].view_id : undefined;
      }
    }

    return getLastChildViewId(view) ?? fallbackViewId;
  };

  const { tabsParentViewId, prevViewId, embedded } = await (async (): Promise<{
    tabsParentViewId: string;
    prevViewId?: string;
    embedded: boolean;
  }> => {
    // Best-effort: fall back to previous behavior if meta lookup isn't available.
    if (!loadViewMeta) {
      return { tabsParentViewId: databasePageId, embedded: isDocumentBlock ?? false };
    }

    const safeLoadViewMeta = async (viewId: string): Promise<View | null> => {
      try {
        return await loadViewMeta(viewId);
      } catch {
        return null;
      }
    };

    // A child lookup can fail while the page's container is still available.
    // Resolve that known identity before falling back to presentation state.
    const currentMeta =
      (await safeLoadViewMeta(requestViewId)) ??
      (requestViewId !== databasePageId ? await safeLoadViewMeta(databasePageId) : null);

    // Scope belongs to the saved container, even when an embedded database
    // is opened full-page or a standalone database is shown in a document.
    // Legacy linked leaves may carry a container marker without children.
    if (isDatabaseContainer(currentMeta) && !isEmbeddedDatabaseViewWithoutChildren(currentMeta)) {
      return {
        tabsParentViewId: currentMeta.view_id,
        prevViewId: getInsertionPrevViewId(currentMeta),
        embedded: isEmbeddedView(currentMeta),
      };
    }

    const parentId = currentMeta?.parent_view_id;
    const embedded = isEmbeddedView(currentMeta) || (isDocumentBlock ?? false);

    if (!parentId) {
      return { tabsParentViewId: databasePageId, embedded };
    }

    // If parent is a database container, attach under the container (Scenario 4).
    const parentMeta = await safeLoadViewMeta(parentId);

    if (isDatabaseContainer(parentMeta)) {
      return {
        tabsParentViewId: parentId,
        prevViewId: getInsertionPrevViewId(parentMeta),
        embedded: isEmbeddedView(parentMeta),
      };
    }

    // Embedded databases without a container attach under the document (Scenario 3).
    if (embedded) {
      return {
        tabsParentViewId: parentId,
        prevViewId: getInsertionPrevViewId(parentMeta, currentMeta?.view_id),
        embedded,
      };
    }

    // Backward-compatible fallback: attach under the current database view.
    const databasePageMeta =
      currentMeta?.view_id === databasePageId ? currentMeta : await safeLoadViewMeta(databasePageId);

    return {
      tabsParentViewId: databasePageId,
      prevViewId: getInsertionPrevViewId(databasePageMeta),
      embedded,
    };
  })();

  const existingViewIds = new Set(database?.get(YjsDatabaseKey.views)?.keys() ?? []);
  const requiresIsolatedValidation =
    layout === DatabaseViewLayout.Gallery ||
    layout === DatabaseViewLayout.Feed ||
    options?.requireExactCreatedView === true;
  const preRequestState = requiresIsolatedValidation ? Y.encodeStateAsUpdate(databaseDoc) : undefined;

  // Create new view as a child of the database container (or document for embedded linked views).
  // A metadata lookup can overlap another client's create or a server-limit refresh.
  assertDatabaseViewCapacity(databaseDoc);
  if (options?.dashboardOwner) assertDashboardViewCreationOnline();
  const response = await createDatabaseView(requestViewId, {
    parent_view_id: tabsParentViewId,
    prev_view_id: prevViewId,
    database_id: databaseId,
    layout: viewLayout,
    name: nameOverride ?? name,
    embedded,
  });

  if (requiresIsolatedValidation) {
    const returnedViewWasNew = Boolean(response.view_id) && !existingViewIds.has(response.view_id);
    const databaseUpdate = response.database_update;
    const hasExactDatabaseUpdate =
      Boolean(response.view_id) &&
      response.database_id === databaseId &&
      preRequestState !== undefined &&
      databaseUpdate !== undefined &&
      databaseUpdate.length > 0 &&
      (layout === DatabaseViewLayout.Feed ? updateCreatesExactFeedView : updateCreatesExactDatabaseView)({
        databaseId,
        existingViewIds,
        preRequestState,
        update: databaseUpdate,
        viewId: response.view_id,
      });

    if (!hasExactDatabaseUpdate) {
      if (response.view_id && returnedViewWasNew) {
        try {
          await deletePage?.(response.view_id);
        } catch (error) {
          Log.warn('[useAddDatabaseView] failed to compensate an invalid database view', {
            viewId: response.view_id,
            layout,
            error,
          });
        }
      }

      throw new Error(`The server did not return the requested ${name} database view`);
    }
  }

  if (response.database_update?.length) {
    applyYDoc(databaseDoc, new Uint8Array(response.database_update));
  }

  if (layout === DatabaseViewLayout.List) {
    const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);
    const createdViewWasNew = !existingViewIds.has(response.view_id);
    const isExactReturnedView =
      Boolean(response.view_id) &&
      createdViewWasNew &&
      response.database_id === databaseId &&
      Boolean(createdView?.get(YjsDatabaseKey.field_orders));

    if (
      !isExactReturnedView ||
      normalizeCreatedDatabaseListView(databaseDoc, response.view_id) !== response.view_id
    ) {
      if (response.view_id && createdViewWasNew) {
        removeCreatedDatabaseView(databaseDoc, response.view_id);

        try {
          await deletePage?.(response.view_id);
        } catch (error) {
          Log.warn('[useAddDatabaseView] failed to roll back an invalid List view', {
            viewId: response.view_id,
            error,
          });
        }
      }

      throw new Error('The server did not return the requested List database view');
    }
  }

  if (layout === DatabaseViewLayout.Gallery) {
    const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);
    const isExactReturnedView =
      Boolean(response.view_id) &&
      !existingViewIds.has(response.view_id) &&
      Boolean(createdView?.get(YjsDatabaseKey.field_orders));

    if (
      !isExactReturnedView ||
      normalizeCreatedDatabaseGalleryView(databaseDoc, response.view_id) !== response.view_id
    ) {
      if (response.view_id && !existingViewIds.has(response.view_id)) {
        removeCreatedDatabaseView(databaseDoc, response.view_id);

        try {
          await deletePage?.(response.view_id);
        } catch (error) {
          Log.warn('[useAddDatabaseView] failed to roll back an invalid Gallery view', {
            viewId: response.view_id,
            error,
          });
        }
      }

      throw new Error('The server did not return the requested Gallery database view');
    }
  }

  if (layout === DatabaseViewLayout.Feed) {
    const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);
    const isExactReturnedView =
      Boolean(response.view_id) &&
      !existingViewIds.has(response.view_id) &&
      Boolean(createdView?.get(YjsDatabaseKey.field_orders));

    if (
      !isExactReturnedView ||
      normalizeCreatedDatabaseFeedView(databaseDoc, response.view_id) !== response.view_id
    ) {
      if (response.view_id && !existingViewIds.has(response.view_id)) {
        removeCreatedDatabaseView(databaseDoc, response.view_id);

        try {
          await deletePage?.(response.view_id);
        } catch (error) {
          Log.warn('[useAddDatabaseView] failed to roll back an invalid Feed view', {
            viewId: response.view_id,
            error,
          });
        }
      }

      throw new Error('The server did not return the requested Feed database view');
    }
  }

  if (options?.dashboardOwner) {
    if (options.writeDashboardOwnerToFolder === false) {
      writeCollabDashboardOwner(databaseDoc, response.view_id, options.dashboardOwner);
    } else {
      // Waits for the first folder attempt only; retries run detached.
      await markDashboardOwnedView({ databaseDoc, loadViewMeta, updatePage }, response.view_id, options.dashboardOwner);
    }
  }

  if (layout === DatabaseViewLayout.Dashboard) {
    // The server writes no dashboard settings; seed the empty rows / global
    // filters so every reader sees a stable shape from the first render.
    // Like the other created-tab writes, the seed is not an undo step.
    const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);

    if (createdView) seedDashboardLayoutSetting(databaseDoc, createdView);
  }

  return response.view_id;
}

const DUPLICATED_DATABASE_VIEW_CONFIGURATION_KEYS = [
  YjsDatabaseKey.field_orders,
  YjsDatabaseKey.field_settings,
  YjsDatabaseKey.form_field_settings,
  YjsDatabaseKey.filters,
  YjsDatabaseKey.groups,
  YjsDatabaseKey.layout_settings,
  YjsDatabaseKey.sorts,
  YjsDatabaseKey.calculations,
  // How the view opens records (WP13 §3.8); absent stays absent.
  YjsDatabaseKey.open_pages_in,
] as const;

/**
 * A native client's integers arrive as bigints, which Yjs stores but refuses
 * to author directly in a Y map or array; the web writes JS numbers, and every
 * reader accepts both (ARCHITECTURE §3.1.6).
 */
function toAuthorableYValue(value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

/** Deep-copy a stored view value: Y maps and arrays become new Y types, plain JSON is copied. */
export function cloneDatabaseViewConfigurationValue<T>(value: T): T;
export function cloneDatabaseViewConfigurationValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const clone = new Y.Map<unknown>();

    value.forEach((childValue, key) => {
      clone.set(key, toAuthorableYValue(cloneDatabaseViewConfigurationValue(childValue)));
    });
    return clone;
  }

  if (value instanceof Y.Array) {
    const clone = new Y.Array<unknown>();

    clone.push(value.toArray().map((item) => toAuthorableYValue(cloneDatabaseViewConfigurationValue(item))));
    return clone;
  }

  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map((item) => cloneDatabaseViewConfigurationValue(item));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
        key,
        cloneDatabaseViewConfigurationValue(childValue),
      ])
    );
  }

  return value;
}

export function copyDatabaseViewConfiguration(
  source: YDatabaseView,
  target: YDatabaseView,
  canonicalRowOrders?: YDatabaseRowOrders
) {
  const sourceMap = source as unknown as Y.Map<unknown>;
  const targetMap = target as unknown as Y.Map<unknown>;

  DUPLICATED_DATABASE_VIEW_CONFIGURATION_KEYS.forEach((key) => {
    const value = sourceMap.get(key);

    if (value === undefined) {
      targetMap.delete(key);
      return;
    }

    targetMap.set(key, cloneDatabaseViewConfigurationValue(value));
  });

  const sourceRowOrders = source.get(YjsDatabaseKey.row_orders);

  if (!sourceRowOrders) {
    targetMap.delete(YjsDatabaseKey.row_orders);
    return;
  }

  const visibleRowOrders = materializeVisibleRowOrders(sourceRowOrders.toJSON(), canonicalRowOrders?.toJSON()) ?? [];
  const copiedRowOrders = new Y.Array() as YDatabaseRowOrders;

  copiedRowOrders.push(
    visibleRowOrders.map((rowOrder) => cloneDatabaseViewConfigurationValue(rowOrder)) as Array<{
      id: RowId;
      height: number;
      is_deleted?: boolean;
    }>
  );
  target.set(YjsDatabaseKey.row_orders, copiedRowOrders);
}

export interface DuplicateDatabaseViewOptions extends Pick<AddDatabaseViewOptions, 'writeDashboardOwnerToFolder'> {
  /** The dashboard view that owns the copy (WP05 §1.1). */
  dashboardOwner?: string;
  /**
   * Place the copy right before its source, as the tab menu does (default).
   * `false` appends it like any new view of the database (a widget's copy).
   */
  placeBeforeSource?: boolean;
  /**
   * Runs once the copy holds the source's configuration. A rejection removes
   * the copy and is rethrown, like any other failure of the duplicate.
   */
  afterCopy?: (copy: { viewId: string; layout: DatabaseViewLayout }) => Promise<void>;
}

/**
 * Duplicate a database view while retaining the source database and rows.
 * The server creates the new child view/folder entry; the client then copies
 * the source's per-view configuration into that exact returned view. Any
 * failure removes everything this call created.
 *
 * This copies one view. A dashboard also needs its own copies of the views its
 * widgets own: duplicate a tab with `duplicateDatabaseViewWithOwnedWidgets`.
 */
export async function duplicateDatabaseViewInDoc(
  deps: DatabaseViewDocDeps,
  sourceViewId: string,
  duplicatedName?: string,
  options?: DuplicateDatabaseViewOptions
): Promise<string> {
  const { databaseDoc, deletePage } = deps;
  const database = getDatabaseFromDoc(databaseDoc);
  const views = database?.get(YjsDatabaseKey.views);
  const sourceView = views?.get(sourceViewId);

  if (!database || !views || !sourceView) throw new Error('Database view not found');

  const layout = Number(sourceView.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;
  const targetName = duplicatedName?.trim() || `${sourceView.get(YjsDatabaseKey.name) || 'View'} (Copy)`;
  const existingViewIds = new Set(views.keys());
  let duplicatedViewId: string | undefined;
  let duplicatedViewWasNew = false;

  try {
    duplicatedViewId = await createDatabaseViewInDoc(deps, layout, targetName, {
      insertBeforeViewId: options?.placeBeforeSource === false ? undefined : sourceViewId,
      requireExactCreatedView: true,
      dashboardOwner: options?.dashboardOwner,
      writeDashboardOwnerToFolder: options?.writeDashboardOwnerToFolder,
    });
    duplicatedViewWasNew = Boolean(duplicatedViewId) && !existingViewIds.has(duplicatedViewId);

    if (!duplicatedViewId || !duplicatedViewWasNew) {
      throw new Error('The server did not return a new duplicated database view');
    }

    const duplicatedView = views.get(duplicatedViewId);
    const exactDuplicatedViewId = (duplicatedView as unknown as Y.Map<unknown> | undefined)?.get(YjsDatabaseKey.id);

    if (!duplicatedView || exactDuplicatedViewId !== duplicatedViewId) {
      throw new Error('Duplicated database view not found');
    }

    const canonicalRowOrders = getInlineViewRowOrders(database);

    executeOperations(
      getSharedRoot(databaseDoc),
      [() => copyDatabaseViewConfiguration(sourceView, duplicatedView, canonicalRowOrders)],
      'duplicateDatabaseView',
      { type: 'view.duplicate', policy: 'skip' }
    );

    await options?.afterCopy?.({ viewId: duplicatedViewId, layout });
  } catch (error) {
    if (!duplicatedViewId || !duplicatedViewWasNew) throw error;

    removeCreatedDatabaseView(databaseDoc, duplicatedViewId);

    try {
      await deletePage?.(duplicatedViewId);
    } catch (rollbackError) {
      Log.warn('[useDuplicateDatabaseView] failed to roll back duplicated view', {
        viewId: duplicatedViewId,
        error: rollbackError,
      });
    }

    throw error;
  }

  if (!duplicatedViewId) throw new Error('Duplicated database view not found');

  return duplicatedViewId;
}

/**
 * Delete a database view: move its folder page to the trash, then remove it
 * from the database collab. The body of `useDeleteView`, usable without a hook.
 */
export async function deleteDatabaseViewInDoc(
  deps: Pick<DatabaseViewDocDeps, 'databaseDoc' | 'deletePage'>,
  viewId: string
): Promise<void> {
  const { databaseDoc, deletePage } = deps;

  // Attempt to remove the view from the folder (move to trash).
  // This is a secondary cleanup — the primary operation is the Yjs deletion below.
  // Database views may not exist in the folder (created via collab sync without a
  // corresponding folder entry), or the folder's space ancestry may be broken.
  // In either case we log the failure and proceed with the Yjs deletion so the
  // user is never stuck with an undeletable view tab.
  try {
    await deletePage?.(viewId);
  } catch (e) {
    Log.warn('[useDeleteView] Failed to move view to trash, proceeding with Yjs deletion:', e);
  }

  executeOperations(
    getSharedRoot(databaseDoc),
    [
      () => {
        const views = getDatabaseFromDoc(databaseDoc)?.get(YjsDatabaseKey.views);
        const view = views?.get(viewId);

        if (!view) {
          throw new Error(`View not found`);
        }

        views?.delete(viewId);
      },
    ],
    'deleteView',
    { type: 'view.delete', policy: 'skip' }
  );
}
