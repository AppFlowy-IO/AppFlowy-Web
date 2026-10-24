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
import { assertDashboardViewCreationOnline, assertViewCreationOnline } from '@/application/view-online-policy';
import { Log } from '@/utils/log';

import { seedConvertedDashboardLayout, hasDashboardWidgets } from './dashboard-convert';
import { DASHBOARD_LAYOUT_ORIGIN, readStoredDashboardWidgets } from './dashboard-layout';
import {
  collectDatabaseViewNames,
  DashboardIdMap,
  duplicateBaseName,
  nextViewName,
  readDashboardOwner,
  remapDashboardLayout,
} from './dashboard-owned-views';
import { DASHBOARD_LAYOUT_KEY, DashboardRow, DashboardWidget } from './dashboard.type';
import {
  cloneDatabaseViewConfigurationValue,
  createDatabaseViewInDoc,
  DashboardOwnerWriteOptions,
  DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT,
  DatabaseViewDocDeps,
  deleteDatabaseViewInDoc,
  duplicateDatabaseViewInDoc,
  DuplicateDatabaseViewOptions,
  getDatabaseFromDoc,
  markDashboardOwnedView,
  writeCollabDashboardOwner,
  writeFolderDashboardOwner,
} from './database-view-doc-ops';
import { executeDatabaseOperations as executeOperations } from './history';
import { toPlainValue } from './layout-codec';

/**
 * Non-hook operations on dashboard-owned widget views (WP05 §1, §2.2). They
 * take their dependencies explicitly, so the tab bar, the editor and a
 * dashboard that already unmounted can all run them. Each one that opens
 * another database's doc keeps a retained sync owner while it writes and
 * releases it at the end.
 *
 * The single-view operations they build on (create, duplicate, delete, the
 * owner marker) live in `database-view-doc-ops.ts`.
 */

function getSharedRoot(doc: YDoc) {
  return doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
}

/** The folder view, or `null` when it cannot be loaded (callers fall back to the collab). */
async function safeLoadViewMeta(deps: Pick<DatabaseViewDocDeps, 'loadViewMeta'>, viewId: string) {
  try {
    return (await deps.loadViewMeta?.(viewId)) ?? null;
  } catch (error) {
    Log.warn('[Dashboard] could not load the folder view', { viewId, error });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Database docs: the host doc, or another database's doc opened for a write.
// ---------------------------------------------------------------------------

export type DashboardOwnedViewDeps = DatabaseViewDocDeps;

/** Reject a known owned copy before creating its parent; shared references need no new view. */
export function assertKnownOwnedDashboardCopiesOnline(doc: YDoc, dashboardViewId: string): void {
  const database = getDatabaseFromDoc(doc);
  const views = database?.get(YjsDatabaseKey.views);

  if (readStoredDashboardWidgets(database, dashboardViewId).some((widget) =>
    readDashboardOwner(null, views?.get(widget.viewId)) === dashboardViewId
  )) {
    assertDashboardViewCreationOnline();
  }
}

interface OpenedDatabaseDoc {
  doc: YDoc;
  database: YDatabase | undefined;
  isHost: boolean;
}

function createDatabaseDocCache(deps: DashboardOwnedViewDeps) {
  const hostDatabase = getDatabaseFromDoc(deps.databaseDoc);
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
        return { doc, database: getDatabaseFromDoc(doc), isHost: false };
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

async function removeCreatedView(deps: DashboardOwnedViewDeps, doc: YDoc, viewId: string, context: string) {
  try {
    await deleteDatabaseViewInDoc({ databaseDoc: doc, deletePage: deps.deletePage }, viewId);
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

/**
 * Create a new view owned by `owner`, named with `nextViewName` among its
 * database's views: the picker's new views and the add flow's default widget
 * view.
 */
export async function createOwnedDatabaseView(
  deps: DashboardOwnedViewDeps,
  params: CreateOwnedDatabaseViewParams
): Promise<string> {
  assertDashboardViewCreationOnline();
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
  /** The copy's name: kept verbatim, unless `numbered`. */
  name: string;
  /**
   * Number the copy like a widget duplicate (WP05 §1.3): the first free
   * `"<base> (n)"` among the database's view names, `base` being `name`
   * without one trailing `" (n)"`.
   */
  numbered?: boolean;
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
  assertDashboardViewCreationOnline();
  const docs = createDatabaseDocCache(deps);

  try {
    const opened = await docs.open(params.databaseId, params.anchorViewId ?? params.sourceViewId);
    const viewDeps =
      params.anchorViewId || !opened.isHost
        ? anchoredDeps(deps, opened, params.anchorViewId ?? params.sourceViewId)
        : deps;
    const name = params.numbered
      ? nextViewName(
          duplicateBaseName(params.name),
          collectDatabaseViewNames(
            opened.database,
            await folderNamesAround(deps, params.anchorViewId ?? params.sourceViewId)
          )
        )
      : params.name;
    const viewId = await duplicateDatabaseViewWithOwnedWidgets(viewDeps, params.sourceViewId, name, {
      dashboardOwner: params.owner,
      placeBeforeSource: false,
    });

    await docs.flush();
    return viewId;
  } finally {
    docs.release();
  }
}

/**
 * Delete an owned widget view the normal way (folder trash, then the view in
 * its database collab): the host's doc, else the database's doc opened for
 * the write. Used by the owned-view deletion queue and for a view that never
 * reached a widget (WP05 §1.5, WP06 §1.1). Not an undo step.
 */
export async function deleteOwnedDatabaseView(
  deps: DashboardOwnedViewDeps,
  params: { viewId: string; databaseId: string }
): Promise<void> {
  const docs = createDatabaseDocCache(deps);

  try {
    const opened = await docs.open(params.databaseId, params.viewId).catch((error) => {
      Log.warn('[Dashboard] could not open the database of an owned view', { ...params, error });
      return null;
    });

    if (!opened || !opened.database?.get(YjsDatabaseKey.views)?.get(params.viewId)) {
      // The collab view is already gone (or out of reach): the folder page still goes.
      await deps.deletePage?.(params.viewId);
      return;
    }

    await deleteDatabaseViewInDoc({ databaseDoc: opened.doc, deletePage: deps.deletePage }, params.viewId);
    await docs.flush();
  } finally {
    docs.release();
  }
}

/**
 * The authoritative owner of a view at the time of a deletion: the folder
 * marker, else the collab mirror in the host's doc or `knownDoc` (WP05 §1.1:
 * read either, write both). `null` when neither says.
 */
export async function resolveDashboardViewOwner(
  deps: Pick<DashboardOwnedViewDeps, 'databaseDoc' | 'loadViewMeta'>,
  viewId: string,
  knownDoc?: YDoc | null
): Promise<string | null> {
  const meta = await safeLoadViewMeta(deps, viewId);
  const collabView =
    getDatabaseFromDoc(deps.databaseDoc)?.get(YjsDatabaseKey.views)?.get(viewId) ??
    getDatabaseFromDoc(knownDoc ?? undefined)?.get(YjsDatabaseKey.views)?.get(viewId);

  return readDashboardOwner(meta, collabView);
}

/**
 * Rename a view in its folder and its database collab (not an undo step), as
 * a tab rename does. The widget name field uses it for a view of another
 * database than the host's.
 */
export async function renameDatabaseViewInDoc(params: {
  doc: YDoc;
  viewId: string;
  name: string;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
}): Promise<boolean> {
  const name = params.name.trim();
  const view = getDatabaseFromDoc(params.doc)?.get(YjsDatabaseKey.views)?.get(params.viewId);

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

/** One widget per view, in order. */
function uniqueWidgets(widgets: DashboardWidget[]): DashboardWidget[] {
  const seen = new Set<string>();

  return widgets.filter((widget) => !seen.has(widget.viewId) && seen.add(widget.viewId));
}

/**
 * The owner of a widget's view: the folder marker when set, else the collab
 * mirror in the widget's own database (opened only when the folder is silent).
 */
async function resolveWidgetOwner(
  docs: ReturnType<typeof createDatabaseDocCache>,
  widget: DashboardWidget,
  meta: View | null
): Promise<string | null> {
  const folderOwner = readDashboardOwner(meta);

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
 *
 * The copies are made one after another (each placement reads the folder the
 * previous copy changed). Their folder owner markers are written together at
 * the end, one attempt each; a failed one retries detached and the collab
 * mirror, written with the copy, hides the view meanwhile.
 */
export async function duplicateDashboardOwnedWidgets(
  deps: DashboardOwnedViewDeps,
  params: DuplicateDashboardOwnedWidgetsParams
): Promise<Record<string, string>> {
  const { sourceDashboardViewId, targetDashboardViewId } = params;

  assertKnownOwnedDashboardCopiesOnline(deps.databaseDoc, sourceDashboardViewId);
  const hostDatabase = getDatabaseFromDoc(deps.databaseDoc);
  const setting = hostDatabase
    ?.get(YjsDatabaseKey.views)
    ?.get(targetDashboardViewId)
    ?.get(YjsDatabaseKey.layout_settings)
    ?.get(DASHBOARD_LAYOUT_KEY);

  if (!setting) return {};
  // Every stored widget: the ones hidden by the widget limit are remapped too.
  const widgets = uniqueWidgets(readStoredDashboardWidgets(hostDatabase, targetDashboardViewId));
  const docs = createDatabaseDocCache(deps);
  const viewIdMap: Record<string, string> = {};
  const created: { viewId: string; doc: YDoc }[] = [];

  try {
    const candidates = await Promise.all(
      widgets.map(async (widget) => {
        const meta = await safeLoadViewMeta(deps, widget.viewId);

        return { widget, meta, owner: await resolveWidgetOwner(docs, widget, meta) };
      })
    );

    // Foreign source ownership may only become known after resolving its metadata.
    // Refuse before any owned copy is created, even if the connection changed during lookup.
    if (candidates.some(({ owner }) => owner === sourceDashboardViewId)) assertDashboardViewCreationOnline();

    for (const { widget, meta, owner } of candidates) {
      if (owner !== sourceDashboardViewId) continue;

      const opened = await docs.open(widget.databaseId, widget.viewId);
      const sourceName = meta?.name || opened.database?.get(YjsDatabaseKey.views)?.get(widget.viewId)?.get(YjsDatabaseKey.name);
      const copyId = await duplicateDatabaseViewWithOwnedWidgets(
        anchoredDeps(deps, opened, widget.viewId),
        widget.viewId,
        sourceName || undefined,
        { dashboardOwner: targetDashboardViewId, placeBeforeSource: false, writeDashboardOwnerToFolder: false }
      );

      created.push({ viewId: copyId, doc: opened.doc });
      viewIdMap[widget.viewId] = copyId;
    }

    if (created.length > 0) writeRemappedDashboardLayout(deps.databaseDoc, setting, viewIdMap, {});
    await Promise.all([
      docs.flush(),
      ...created.map((copy) =>
        markDashboardOwnedView(
          { databaseDoc: copy.doc, loadViewMeta: deps.loadViewMeta, updatePage: deps.updatePage },
          copy.viewId,
          targetDashboardViewId
        )
      ),
    ]);
    return viewIdMap;
  } catch (error) {
    for (const copy of created.reverse()) {
      await removeCreatedView(deps, copy.doc, copy.viewId, 'a duplicated dashboard');
    }

    throw error;
  } finally {
    docs.release();
  }
}

/**
 * Duplicate a database tab (the body of `useDuplicateDatabaseView`): the view
 * itself and, for a dashboard, its own copies of the views its widgets own
 * (WP05 §1.7). Any failure removes everything this call created.
 */
export async function duplicateDatabaseViewWithOwnedWidgets(
  deps: DashboardOwnedViewDeps,
  sourceViewId: string,
  duplicatedName?: string,
  options?: Omit<DuplicateDatabaseViewOptions, 'afterCopy'>
): Promise<string> {
  const source = getDatabaseFromDoc(deps.databaseDoc)?.get(YjsDatabaseKey.views)?.get(sourceViewId);

  if (options?.dashboardOwner) assertDashboardViewCreationOnline();
  if (Number(source?.get(YjsDatabaseKey.layout)) === DatabaseViewLayout.Dashboard) {
    assertKnownOwnedDashboardCopiesOnline(deps.databaseDoc, sourceViewId);
  }

  return duplicateDatabaseViewInDoc(deps, sourceViewId, duplicatedName, {
    ...options,
    afterCopy: async ({ viewId, layout }) => {
      if (layout !== DatabaseViewLayout.Dashboard) return;
      await duplicateDashboardOwnedWidgets(deps, { sourceDashboardViewId: sourceViewId, targetDashboardViewId: viewId });
    },
  });
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
  const views = getDatabaseFromDoc(doc)?.get(YjsDatabaseKey.views);
  const source = views?.get(sourceViewId)?.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY);
  const target = views?.get(targetViewId);

  if (!source || !target) return false;
  doc.transact(() => {
    let layouts = target.get(YjsDatabaseKey.layout_settings);

    if (!layouts) {
      layouts = new Y.Map() as YDatabaseLayoutSettings;
      target.set(YjsDatabaseKey.layout_settings, layouts);
    }

    layouts.set(DASHBOARD_LAYOUT_KEY, cloneDatabaseViewConfigurationValue(source));
  }, DASHBOARD_LAYOUT_ORIGIN.copy);
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
 *
 * The layout switches once V′ exists and the first attempt at its folder owner
 * marker has returned; a failed attempt retries detached.
 */
export async function convertViewToDashboard(
  deps: DashboardOwnedViewDeps,
  params: ConvertViewToDashboardParams
): Promise<boolean> {
  const { viewId, applyLayout, isCurrent = () => true } = params;
  const { databaseDoc } = deps;
  const database = getDatabaseFromDoc(databaseDoc);
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);
  const databaseId = database?.get(YjsDatabaseKey.id);

  if (!database || !view || !databaseId) throw new Error('View not found');

  if (hasDashboardWidgets(database, viewId)) {
    applyLayout();
    return true;
  }

  assertDashboardViewCreationOnline();

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
      }, DASHBOARD_LAYOUT_ORIGIN.rollback);
    }

    await removeCreatedView(deps, databaseDoc, copyId, 'a converted view');
  };

  if (!isCurrent()) {
    await rollback(false);
    return false;
  }

  let seeded = false;

  try {
    databaseDoc.transact(() => {
      seeded = seedConvertedDashboardLayout(database, viewId, copyId, databaseId);
    }, DASHBOARD_LAYOUT_ORIGIN.seed);
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

export interface RepairDashboardOwnerMarkersOptions extends DashboardOwnerWriteOptions {
  /**
   * The doc of a widget source database the dashboard already has open (its
   * registered source docs). The repair never loads a database itself: only
   * the load scheduler decides when a cold source loads (LOADING-DESIGN R6,
   * R7), so a widget whose doc is not open waits for a later open.
   */
  getOpenDoc?: (databaseId: string) => YDoc | undefined;
}

/**
 * Bring both copies of the owner marker of this dashboard's widget views back
 * in step (WP05 §2.2 step 3.3): a view whose mirror names this dashboard but
 * whose folder extra does not gets the folder marker, and the reverse gets the
 * mirror. Checks the host's views and those of the source docs `getOpenDoc`
 * returns, reading their folder metas in one batch (R5). Resolves to the
 * number of markers written. A writer's dashboard runs it once per open, so a
 * folder marker that failed every attempt of `markDashboardOwnedView` is
 * written on the next open.
 */
export async function repairDashboardOwnerMarkers(
  deps: DashboardOwnedViewDeps,
  dashboardViewId: string,
  rows: DashboardRow[],
  options: RepairDashboardOwnerMarkersOptions = {}
): Promise<number> {
  const hostDatabaseId = getDatabaseFromDoc(deps.databaseDoc)?.get(YjsDatabaseKey.id);
  const openDocOf = (databaseId: string | undefined): YDoc | undefined =>
    !databaseId || databaseId === hostDatabaseId ? deps.databaseDoc : options.getOpenDoc?.(databaseId);
  const candidates = uniqueWidgets(rows.flatMap((row) => row.widgets)).flatMap((widget) => {
    const doc = openDocOf(widget.databaseId);

    return doc ? [{ widget, doc }] : [];
  });
  const metas = await Promise.all(candidates.map(({ widget }) => safeLoadViewMeta(deps, widget.viewId)));
  const folderWrites: Promise<boolean>[] = [];
  let written = 0;

  candidates.forEach(({ widget, doc }, index) => {
    const collabView: YDatabaseView | undefined = getDatabaseFromDoc(doc)?.get(YjsDatabaseKey.views)?.get(widget.viewId);
    const folderOwner = readDashboardOwner(metas[index]);
    const collabOwner = readDashboardOwner(null, collabView);

    if (collabOwner === dashboardViewId && !folderOwner) {
      folderWrites.push(writeFolderDashboardOwner(deps, widget.viewId, dashboardViewId, options));
    } else if (folderOwner === dashboardViewId && !collabOwner && collabView) {
      if (writeCollabDashboardOwner(doc, widget.viewId, dashboardViewId)) written += 1;
    }
  });

  return written + (await Promise.all(folderWrites)).filter(Boolean).length;
}
