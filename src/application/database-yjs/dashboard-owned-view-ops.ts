import * as Y from 'yjs';

import {
  DatabaseViewLayout,
  UpdatePagePayload,
  View,
  YDatabase,
  YDatabaseDashboardLayoutSetting,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { assertViewCreationOnline } from '@/application/view-online-policy';
import { Log } from '@/utils/log';

import { seedConvertedDashboardLayout, hasDashboardWidgets } from './dashboard-convert';
import { readDashboardLayoutSetting } from './dashboard-layout';
import {
  collectDatabaseViewNames,
  DASHBOARD_OWNER_KEY,
  DashboardIdMap,
  nextViewName,
  readDashboardOwner,
  remapDashboardLayout,
} from './dashboard-owned-views';
import { DASHBOARD_LAYOUT_KEY, DashboardRow, DashboardWidget } from './dashboard.type';
import {
  cloneDatabaseViewConfigurationValue,
  createDatabaseViewInDoc,
  DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT,
  DatabaseViewDocDeps,
  deleteDatabaseViewInDoc,
  duplicateDatabaseViewInDoc,
} from './dispatch';
import { executeDatabaseOperations as executeOperations } from './history';
import { toPlainValue } from './layout-codec';

/**
 * Non-hook operations on dashboard-owned widget views (WP05 §1, §2.2). They
 * take their dependencies explicitly, so the tab bar, the editor and a
 * dashboard that already unmounted can all run them. Each one that opens
 * another database's doc keeps a retained sync owner while it writes and
 * releases it at the end.
 */

export { deleteDatabaseViewInDoc } from './dispatch';

/** The folder PATCH retries after these waits (ms) before leaving the marker to the repair pass. */
export const DASHBOARD_OWNER_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 4000];

export type DashboardOwnerMarkerDeps = Pick<DatabaseViewDocDeps, 'databaseDoc' | 'loadViewMeta' | 'updatePage'>;

export interface DashboardOwnerWriteOptions {
  retryDelaysMs?: readonly number[];
  /** Test seam for the waits between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

function getDatabase(doc: YDoc | undefined) {
  return doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase | undefined;
}

function getSharedRoot(doc: YDoc) {
  return doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function nonEmptyOwner(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function safeLoadViewMeta(deps: Pick<DatabaseViewDocDeps, 'loadViewMeta'>, viewId: string) {
  try {
    return (await deps.loadViewMeta?.(viewId)) ?? null;
  } catch {
    return null;
  }
}

/** Write `owner` on the collab mirror of `viewId` (not an undo step). */
function writeCollabDashboardOwner(doc: YDoc, viewId: string, owner: string): boolean {
  const view = getDatabase(doc)?.get(YjsDatabaseKey.views)?.get(viewId);

  if (!view) return false;
  if (view.get(DASHBOARD_OWNER_KEY) === owner) return true;
  executeOperations(getSharedRoot(doc), [() => view.set(DASHBOARD_OWNER_KEY, owner)], 'markDashboardOwnedView', {
    type: 'view.dashboard-owner',
    policy: 'skip',
  });
  return true;
}

/**
 * Write `owner` into the folder view's `extra`. The server replaces `extra`
 * and refuses a payload that drops its own keys, so every attempt re-reads
 * the fresh meta and merges into it: unknown keys survive.
 */
async function writeFolderDashboardOwner(
  deps: Pick<DashboardOwnerMarkerDeps, 'loadViewMeta' | 'updatePage'>,
  viewId: string,
  owner: string,
  options: DashboardOwnerWriteOptions = {}
): Promise<boolean> {
  const { loadViewMeta, updatePage } = deps;

  if (!loadViewMeta || !updatePage) return false;
  const delays = options.retryDelaysMs ?? DASHBOARD_OWNER_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt - 1]);

    try {
      const meta = await loadViewMeta(viewId, undefined, { authoritative: true });

      if (!meta) throw new Error('View not found');
      if (meta.extra?.dashboard_owner === owner) return true;
      await updatePage(viewId, {
        name: meta.name,
        icon: meta.icon ?? undefined,
        extra: { ...(meta.extra ?? {}), dashboard_owner: owner },
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  // The collab mirror already hides the view; the repair pass rewrites the folder copy.
  Log.warn('[Dashboard] failed to write the owner marker to the folder', { viewId, owner, error: lastError });
  return false;
}

/**
 * Mark `viewId` as owned by the dashboard view `owner` (WP05 §1.1): the collab
 * mirror first, synchronously, so local tab bars hide the view at once; then
 * the authoritative folder extra, with retries. Never throws; resolves to
 * whether the folder copy was written.
 */
export async function markDashboardOwnedView(
  deps: DashboardOwnerMarkerDeps,
  viewId: string,
  owner: string,
  options?: DashboardOwnerWriteOptions
): Promise<boolean> {
  writeCollabDashboardOwner(deps.databaseDoc, viewId, owner);
  return writeFolderDashboardOwner(deps, viewId, owner, options);
}

// ---------------------------------------------------------------------------
// Database docs: the host doc, or another database's doc opened for a write.
// ---------------------------------------------------------------------------

export type DashboardOwnedViewDeps = DatabaseViewDocDeps;

interface OpenedDatabaseDoc {
  doc: YDoc;
  database: YDatabase | undefined;
  isHost: boolean;
}

function createDatabaseDocCache(deps: DashboardOwnedViewDeps) {
  const hostDatabase = getDatabase(deps.databaseDoc);
  const hostDatabaseId = hostDatabase?.get(YjsDatabaseKey.id);
  const opened = new Map<string, Promise<OpenedDatabaseDoc>>();
  const owners: { doc: YDoc; flush?: () => Promise<boolean> }[] = [];

  const open = (databaseId: string | undefined, anchorViewId: string): Promise<OpenedDatabaseDoc> => {
    if (!databaseId || databaseId === hostDatabaseId) {
      return Promise.resolve({ doc: deps.databaseDoc, database: hostDatabase, isHost: true });
    }

    let pending = opened.get(databaseId);

    if (!pending) {
      pending = (async () => {
        if (!deps.loadView) throw new Error('The widget source database is not available');
        const doc = await deps.loadView(anchorViewId, false, false, { databaseId });
        // A retained owner persists the writes whether or not the database is
        // open elsewhere; releasing it drops only this reference.
        const syncContext = deps.scheduleDeferredCleanup ? deps.bindViewSync?.(doc, { retain: true }) ?? null : null;

        if (syncContext) owners.push({ doc: syncContext.doc, flush: syncContext.flush });
        return { doc, database: getDatabase(doc), isHost: false };
      })();
      opened.set(databaseId, pending);
    }

    return pending;
  };

  const flush = async () => {
    await Promise.all(owners.map((owner) => owner.flush?.()));
  };

  const release = () => {
    owners.splice(0).forEach((owner) => {
      try {
        deps.scheduleDeferredCleanup?.(owner.doc.guid);
      } catch (error) {
        Log.warn('[Dashboard] failed to release a temporary sync owner', { objectId: owner.doc.guid, error });
      }
    });
  };

  return { open, flush, release };
}

/**
 * The deps of a view operation in `opened`, anchored on `anchorViewId` so a
 * new view is placed like its anchor (next to it, under the same container or
 * document).
 */
function anchoredDeps(
  deps: DashboardOwnedViewDeps,
  opened: OpenedDatabaseDoc,
  anchorViewId: string
): DashboardOwnedViewDeps {
  return {
    ...deps,
    databaseDoc: opened.doc,
    databasePageId: anchorViewId,
    activeViewId: anchorViewId,
    isDocumentBlock: opened.isHost ? deps.isDocumentBlock : false,
  };
}

/** Every folder name of the views next to `anchorViewId` (its container's or document's children). */
async function folderNamesAround(deps: DashboardOwnedViewDeps, anchorViewId: string) {
  const names = new Map<string, string>();
  const anchor = await safeLoadViewMeta(deps, anchorViewId);
  const parent = anchor?.parent_view_id ? await safeLoadViewMeta(deps, anchor.parent_view_id) : null;
  const add = (view: View | null | undefined) => {
    if (view?.view_id && view.name) names.set(view.view_id, view.name);
  };

  add(anchor);
  (anchor?.children ?? []).forEach(add);
  (parent?.children ?? []).forEach(add);
  return names;
}

async function removeCreatedView(
  deps: DashboardOwnedViewDeps,
  opened: OpenedDatabaseDoc,
  viewId: string,
  context: string
) {
  try {
    await deleteDatabaseViewInDoc({ databaseDoc: opened.doc, deletePage: deps.deletePage }, viewId);
  } catch (error) {
    Log.warn(`[Dashboard] failed to remove a view created for ${context}`, { viewId, error });
  }
}

// ---------------------------------------------------------------------------
// Owned views
// ---------------------------------------------------------------------------

export interface CreateOwnedDatabaseViewParams {
  /** The database of the new view (the host's or a widget source's). */
  databaseId: string;
  /** A view of that database the new view is placed next to. */
  anchorViewId: string;
  layout: DatabaseViewLayout;
  /** The name before numbering (the layout label): "Board", then "Board (1)". */
  baseName: string;
  /** The owning dashboard view id. */
  owner: string;
}

/** Create a new view owned by `owner`, named with `nextViewName` among its database's views. */
export async function createOwnedDatabaseView(
  deps: DashboardOwnedViewDeps,
  params: CreateOwnedDatabaseViewParams
): Promise<string> {
  const docs = createDatabaseDocCache(deps);

  try {
    const opened = await docs.open(params.databaseId, params.anchorViewId);
    const names = collectDatabaseViewNames(opened.database, await folderNamesAround(deps, params.anchorViewId));
    const viewId = await createDatabaseViewInDoc(
      anchoredDeps(deps, opened, params.anchorViewId),
      params.layout,
      nextViewName(params.baseName, names),
      { dashboardOwner: params.owner }
    );

    await docs.flush();
    return viewId;
  } finally {
    docs.release();
  }
}

export interface DuplicateOwnedDatabaseViewParams {
  sourceViewId: string;
  /** The source view's database; the host's when absent. */
  databaseId?: string;
  owner: string;
  /** The copy's name: kept verbatim. */
  name: string;
  /**
   * Place the copy next to this view. Without it the copy is placed like any
   * new view of the host context (the tab bar's "+").
   */
  anchorViewId?: string;
}

/**
 * Copy a view (layout and its whole configuration: filters, sorts, groups,
 * field settings, calculations, every layout setting) as a view owned by
 * `owner`. The copy is appended, never inserted before its source.
 */
export async function duplicateOwnedDatabaseView(
  deps: DashboardOwnedViewDeps,
  params: DuplicateOwnedDatabaseViewParams
): Promise<string> {
  const docs = createDatabaseDocCache(deps);

  try {
    const opened = await docs.open(params.databaseId, params.anchorViewId ?? params.sourceViewId);
    const viewDeps =
      params.anchorViewId || !opened.isHost
        ? anchoredDeps(deps, opened, params.anchorViewId ?? params.sourceViewId)
        : deps;
    const viewId = await duplicateDatabaseViewInDoc(viewDeps, params.sourceViewId, params.name, {
      dashboardOwner: params.owner,
      placeBeforeSource: false,
    });

    await docs.flush();
    return viewId;
  } finally {
    docs.release();
  }
}

/** Rename a view in its folder and its database collab (not an undo step), as a tab rename does. */
export async function renameDatabaseViewInDoc(params: {
  doc: YDoc;
  viewId: string;
  name: string;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
}): Promise<boolean> {
  const name = params.name.trim();
  const view = getDatabase(params.doc)?.get(YjsDatabaseKey.views)?.get(params.viewId);

  if (!name || view?.get(YjsDatabaseKey.name) === name) return false;
  await params.updatePage?.(params.viewId, { name });
  if (view) {
    executeOperations(getSharedRoot(params.doc), [() => view.set(YjsDatabaseKey.name, name)], 'renameDatabaseView', {
      type: 'view.rename',
      policy: 'skip',
    });
  }

  return true;
}

function uniqueWidgets(rows: DashboardRow[]): DashboardWidget[] {
  const seen = new Set<string>();

  return rows.flatMap((row) => row.widgets).filter((widget) => !seen.has(widget.viewId) && seen.add(widget.viewId));
}

/**
 * The owner of a widget's view: the folder marker when set, else the collab
 * mirror in the widget's own database (opened only when the folder is silent).
 */
async function resolveWidgetOwner(
  deps: DashboardOwnedViewDeps,
  docs: ReturnType<typeof createDatabaseDocCache>,
  widget: DashboardWidget,
  meta: View | null
): Promise<string | null> {
  const folderOwner = nonEmptyOwner(meta?.extra?.dashboard_owner);

  if (folderOwner) return folderOwner;

  try {
    const opened = await docs.open(widget.databaseId, widget.viewId);

    return readDashboardOwner(null, opened.database?.get(YjsDatabaseKey.views)?.get(widget.viewId));
  } catch (error) {
    Log.warn('[Dashboard] could not read the owner of a widget view', { viewId: widget.viewId, error });
    return null;
  }
}

export interface DuplicateDashboardOwnedWidgetsParams {
  sourceDashboardViewId: string;
  /** The new dashboard, whose layout setting already holds a full copy of the source's. */
  targetDashboardViewId: string;
}

/**
 * Give a duplicated dashboard its own copies of the views the source owns
 * (WP05 §1.7): each owned widget view is copied as a view owned by the target
 * (same name, same database, placed next to its source) and the target's
 * layout is remapped onto the copies. Shared views stay shared. Not an undo
 * step. On any failure the copies made so far are deleted and the error is
 * rethrown, so the caller can remove the target too. Resolves to the map of
 * source view id to copy id.
 */
export async function duplicateDashboardOwnedWidgets(
  deps: DashboardOwnedViewDeps,
  params: DuplicateDashboardOwnedWidgetsParams
): Promise<Record<string, string>> {
  const { sourceDashboardViewId, targetDashboardViewId } = params;
  const hostDatabase = getDatabase(deps.databaseDoc);
  const setting = hostDatabase
    ?.get(YjsDatabaseKey.views)
    ?.get(targetDashboardViewId)
    ?.get(YjsDatabaseKey.layout_settings)
    ?.get(DASHBOARD_LAYOUT_KEY);

  if (!setting) return {};
  const widgets = uniqueWidgets(readDashboardLayoutSetting(hostDatabase, targetDashboardViewId).rows);
  const docs = createDatabaseDocCache(deps);
  const viewIdMap: Record<string, string> = {};
  const created: { viewId: string; databaseId: string }[] = [];

  try {
    for (const widget of widgets) {
      const meta = await safeLoadViewMeta(deps, widget.viewId);

      if ((await resolveWidgetOwner(deps, docs, widget, meta)) !== sourceDashboardViewId) continue;

      const opened = await docs.open(widget.databaseId, widget.viewId);
      const sourceName = meta?.name || opened.database?.get(YjsDatabaseKey.views)?.get(widget.viewId)?.get(YjsDatabaseKey.name);
      const copyId = await duplicateDatabaseViewInDoc(
        anchoredDeps(deps, opened, widget.viewId),
        widget.viewId,
        sourceName || undefined,
        { dashboardOwner: targetDashboardViewId, placeBeforeSource: false }
      );

      created.push({ viewId: copyId, databaseId: widget.databaseId });
      viewIdMap[widget.viewId] = copyId;
    }

    if (created.length > 0) writeRemappedDashboardLayout(deps.databaseDoc, setting, viewIdMap, {});
    await docs.flush();
    return viewIdMap;
  } catch (error) {
    for (const copy of created.reverse()) {
      const opened = await docs.open(copy.databaseId, copy.viewId).catch(() => null);

      if (opened) await removeCreatedView(deps, opened, copy.viewId, 'a duplicated dashboard');
    }

    throw error;
  } finally {
    docs.release();
  }
}

/** Rewrite `rows` / `global_filters` of a stored dashboard setting through `remapDashboardLayout` (not an undo step). */
function writeRemappedDashboardLayout(
  doc: YDoc,
  setting: YDatabaseDashboardLayoutSetting,
  viewIdMap: DashboardIdMap,
  databaseIdMap: DashboardIdMap
) {
  const layout = toPlainValue(setting) as Record<string, unknown>;
  const remapped = remapDashboardLayout(layout, viewIdMap, databaseIdMap);

  if (remapped === layout) return;
  executeOperations(
    getSharedRoot(doc),
    [
      () => {
        if (remapped.rows !== layout.rows) setting.set(YjsDatabaseKey.dashboard_rows, remapped.rows);
        if (remapped.global_filters !== layout.global_filters) {
          setting.set(YjsDatabaseKey.dashboard_global_filters, remapped.global_filters);
        }
      },
    ],
    'remapDashboardLayout',
    { type: 'view.dashboard-remap', policy: 'skip' }
  );
}

/**
 * Copy `sourceViewId`'s whole dashboard setting (every key, unknown ones
 * included) onto `targetViewId` (not an undo step). Returns false when the
 * source has no setting.
 */
export function copyDashboardLayoutSetting(doc: YDoc, sourceViewId: string, targetViewId: string): boolean {
  const views = getDatabase(doc)?.get(YjsDatabaseKey.views);
  const source = views?.get(sourceViewId)?.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY);
  const target = views?.get(targetViewId);

  if (!source || !target) return false;
  doc.transact(() => {
    let layouts = target.get(YjsDatabaseKey.layout_settings);

    if (!layouts) {
      layouts = new Y.Map() as YDatabaseLayoutSettings;
      target.set(YjsDatabaseKey.layout_settings, layouts);
    }

    layouts.set(DASHBOARD_LAYOUT_KEY, cloneDatabaseViewConfigurationValue(source) as never);
  }, 'initializeDashboardLayout');
  return true;
}

// ---------------------------------------------------------------------------
// Conversion (WP05 §1.6)
// ---------------------------------------------------------------------------

export interface ConvertViewToDashboardParams {
  viewId: string;
  /** The undoable layout change (`useUpdateDatabaseLayout`'s write). */
  applyLayout: () => void;
  /** False once a later layout choice superseded this one. */
  isCurrent?: () => boolean;
}

/**
 * Switch a view to Dashboard so that it keeps showing: when its stored rows
 * are absent or empty, an owned copy V′ (owner = the view, same name, the
 * whole configuration) is created and seeded as one full-width widget in a
 * non-undo transaction, then the undoable layout change runs. A view that
 * already has widgets (converted before) only switches. If anything fails
 * after V′ exists, V′ is deleted and the seed undone. Resolves to whether the
 * layout changed (false when superseded).
 */
export async function convertViewToDashboard(
  deps: DashboardOwnedViewDeps,
  params: ConvertViewToDashboardParams
): Promise<boolean> {
  const { viewId, applyLayout, isCurrent = () => true } = params;
  const { databaseDoc } = deps;
  const database = getDatabase(databaseDoc);
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
  const databaseId = database?.get(YjsDatabaseKey.id);

  if (!database || !view || !databaseId) throw new Error('View not found');

  if (hasDashboardWidgets(database, viewId)) {
    applyLayout();
    return true;
  }

  const sourceLayout = Number(view.get(YjsDatabaseKey.layout)) as DatabaseViewLayout;
  const sourceViewLayout = DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT[sourceLayout];

  // Copying a Chart or Form view creates one, which needs the server (R5).
  if (sourceViewLayout !== undefined) assertViewCreationOnline(sourceViewLayout);

  const meta = await safeLoadViewMeta(deps, viewId);
  const name = meta?.name || (view.get(YjsDatabaseKey.name) as string | undefined) || '';
  const copyId = await duplicateOwnedDatabaseView(deps, { sourceViewId: viewId, owner: viewId, name });
  const rollback = async (seeded: boolean) => {
    if (seeded) {
      databaseDoc.transact(() => {
        view.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY)?.set(YjsDatabaseKey.dashboard_rows, []);
      }, 'initializeDashboardLayout');
    }

    await removeCreatedView(deps, { doc: databaseDoc, database, isHost: true }, copyId, 'a converted view');
  };

  if (!isCurrent()) {
    await rollback(false);
    return false;
  }

  let seeded = false;

  try {
    databaseDoc.transact(() => {
      seeded = seedConvertedDashboardLayout(database, viewId, copyId, databaseId);
    }, 'initializeDashboardLayout');
    applyLayout();
  } catch (error) {
    await rollback(seeded);
    throw error;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * Bring both copies of the owner marker of this dashboard's widget views back
 * in step (WP05 §2.2 step 3.3): a view whose mirror names this dashboard but
 * whose folder extra does not gets the folder marker, and the reverse gets the
 * mirror. Resolves to the number of markers written.
 */
export async function repairDashboardOwnerMarkers(
  deps: DashboardOwnedViewDeps,
  dashboardViewId: string,
  rows: DashboardRow[],
  options?: DashboardOwnerWriteOptions
): Promise<number> {
  const docs = createDatabaseDocCache(deps);
  let written = 0;

  try {
    for (const widget of uniqueWidgets(rows)) {
      const meta = await safeLoadViewMeta(deps, widget.viewId);
      const opened = await docs.open(widget.databaseId, widget.viewId).catch(() => null);
      const collabView: YDatabaseView | undefined = opened?.database?.get(YjsDatabaseKey.views)?.get(widget.viewId);
      const folderOwner = nonEmptyOwner(meta?.extra?.dashboard_owner);
      const collabOwner = nonEmptyOwner(collabView?.get(DASHBOARD_OWNER_KEY));

      if (collabOwner === dashboardViewId && !folderOwner) {
        if (await writeFolderDashboardOwner(deps, widget.viewId, dashboardViewId, options)) written += 1;
      } else if (folderOwner === dashboardViewId && !collabOwner && opened && collabView) {
        if (writeCollabDashboardOwner(opened.doc, widget.viewId, dashboardViewId)) written += 1;
      }
    }

    await docs.flush();
    return written;
  } finally {
    docs.release();
  }
}
