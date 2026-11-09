/**
 * The mention candidates this tab already holds, per workspace: the views the app has loaded, what
 * this tab did to them, and the roster. The mention picker's local lane reads it (MEN-WEB-09);
 * nothing renders it yet.
 *
 * Writers:
 * - `useMentionLocalIndexSources` (in `AppBusinessLayer`): the outline, the recent views and the
 *   trash, kept as references. Nothing is copied until a snapshot is read.
 * - `usePageOperations`: creations (`addPage`), renames (`updatePageName`, and `updatePage` when the
 *   name changes), moves to trash and restores.
 * - `useViewOperations`: opens (`loadView` with awareness, where it also adds the view to the
 *   server's recent views).
 * - `useMentionableUsers`: the roster, whenever it caches one.
 *
 * Candidates follow the server's exclusions: no spaces (their pages stay), no child views of a
 * database (the database stays, and opening one of its views opens it), no embedded or
 * dashboard-owned views, no row documents or row templates, and nothing in the trash, subtree
 * included. A rename shows at once, until the outline catches up or moves past it; a deletion
 * hides the view until the trash list shows it.
 *
 * Limits:
 * - The outline covers six levels (`?depth=6`) and lazily loaded subtrees. Deeper pages count only
 *   once expanded, or while they are among the recent views.
 * - Recent views load lazily (the sidebar's Recent section, search), so `lastViewedAt` may be
 *   missing. The index never fetches.
 * - Pages created outside `addPage` (duplicates, imports, AI chat pages, linked views) arrive with
 *   the next outline refresh, without a session creation time.
 *
 * A workspace is known from the moment the app gives its sources until the app leaves it (another
 * workspace, another account, unmount) or the session ends. Writes for any other workspace are
 * ignored, and its snapshot is the empty one.
 */
import { EventType, on } from '@/application/session/event';
import { MentionablePerson, View, ViewIcon, ViewLayout } from '@/application/types';
import {
  getDatabaseIdFromExtra,
  isDashboardOwnedView,
  isDatabaseContainer,
  isDatabaseLayout,
  isEmbeddedView,
  isSpaceView,
} from '@/application/view-utils';

import { mentionDatabaseNavKey, mentionPageNavKey } from './mentionUtils';

/** At most this many views keep this tab's events per workspace; the least recently touched go first. */
export const MENTION_LOCAL_SESSION_LIMIT = 500;

/** What lists a candidate: the outline, only the recent views, or only this tab's creation. */
export type MentionLocalViewSource = 'outline' | 'recent' | 'session';

export interface MentionLocalView {
  readonly viewId: string;
  /** This tab's name for the view while the sources have not caught up with it, else theirs. */
  readonly name: string;
  readonly layout: ViewLayout;
  readonly icon: ViewIcon | null;
  readonly parentViewId?: string;
  readonly isDatabase: boolean;
  /** A database layout's database id, from the view's `extra`. */
  readonly databaseId?: string;
  /**
   * The database view Search answers for a database layout: the view itself, or a container's first
   * database view, as the server item's `database_view_id`.
   */
  readonly databaseViewId?: string;
  /** The key `mentionItemNavKey` gives the server's item for this view, to merge local and server results by. */
  readonly navKey: string;
  readonly source: MentionLocalViewSource;
  /** Server times in epoch milliseconds, from the outline or the recent views. */
  readonly createdAt?: number;
  readonly lastEditedAt?: number;
  /** When the user last opened the view. Only recent views carry it; a database's views count for it. */
  readonly lastViewedAt?: number;
  /** When this tab created, opened or renamed the view (client clock). */
  readonly sessionCreatedAt?: number;
  readonly sessionOpenedAt?: number;
  readonly sessionRenamedAt?: number;
}

/** One workspace's candidates. The same object comes back until something changes. */
export interface MentionLocalSnapshot {
  /** Unset on the empty snapshot of a workspace the app has not given the index. */
  readonly workspaceId?: string;
  /** Increases with every change; 0 on the empty snapshot. */
  readonly version: number;
  /** Outline order, then views listed only as recent, then this tab's creations; no ranking. */
  readonly views: readonly MentionLocalView[];
  readonly viewsById: ReadonlyMap<string, MentionLocalView>;
  /** The last roster loaded for the workspace, however old. */
  readonly people: readonly MentionablePerson[];
}

export interface MentionIndexSources {
  outline?: readonly View[];
  /** The recent views: the only payload with `last_viewed_at`. */
  recent?: readonly View[];
  trash?: readonly View[];
}

export interface MentionCreatedView {
  viewId: string;
  name: string;
  layout: ViewLayout;
  parentViewId?: string;
  databaseId?: string;
}

interface SessionCreation {
  layout: ViewLayout;
  parentViewId?: string;
  databaseId?: string;
}

/** What this tab did to one view. */
interface SessionView {
  createdAt?: number;
  openedAt?: number;
  renamedAt?: number;
  /** This tab's latest name for the view, shown until the sources catch up with it. */
  name?: string;
  /**
   * The name `name` replaced, as the sources show it until they catch up. For a creation the
   * sources do not list yet, the name they will first show. Unset when unknown: the sources' name
   * then wins as soon as they list the view.
   */
  replacedName?: string;
  /** Moved to trash in this tab: hidden until the trash list shows it or this tab restores it. */
  deleted?: boolean;
  /** Set for this tab's creations, which are listed from here until the sources list them. */
  created?: SessionCreation;
  /** The sources have listed the view, so a creation is no longer listed from the session. */
  listed?: boolean;
}

interface BuiltViews {
  /** The `viewsVersion` the views were built at. */
  version: number;
  views: readonly MentionLocalView[];
  viewsById: ReadonlyMap<string, MentionLocalView>;
}

interface WorkspaceIndex {
  sources: MentionIndexSources;
  session: Map<string, SessionView>;
  /** Changes with the sources and the session. */
  viewsVersion: number;
  /** Changes with everything, the roster included. */
  version: number;
  built?: BuiltViews;
  snapshot?: MentionLocalSnapshot;
}

type BuildingView = { -readonly [K in keyof MentionLocalView]: MentionLocalView[K] };

const NO_VIEWS: readonly MentionLocalView[] = Object.freeze([]);
const NO_PEOPLE: readonly MentionablePerson[] = Object.freeze([]);

/** The snapshot of a workspace the app has not given the index. */
export const EMPTY_MENTION_LOCAL_SNAPSHOT: MentionLocalSnapshot = Object.freeze({
  workspaceId: undefined,
  version: 0,
  views: NO_VIEWS,
  viewsById: new Map<string, MentionLocalView>(),
  people: NO_PEOPLE,
});

const indexes = new Map<string, WorkspaceIndex>();
// Kept apart from the indexes, as long as the roster cache keeps its lists: a workspace the user
// returns to gets its people back at once.
const rosters = new Map<string, readonly MentionablePerson[]>();
const listeners = new Set<() => void>();
let lastVersion = 0;

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function markChanged(index: WorkspaceIndex, viewsChanged: boolean) {
  lastVersion += 1;
  index.version = lastVersion;
  if (viewsChanged) index.viewsVersion = lastVersion;
  notifyListeners();
}

/** The view's session entry, created when missing, and moved to the most recently touched end. */
function touchSession(index: WorkspaceIndex, viewId: string): SessionView {
  const entry = index.session.get(viewId) ?? {};

  index.session.delete(viewId);
  index.session.set(viewId, entry);
  if (index.session.size > MENTION_LOCAL_SESSION_LIMIT) {
    const oldest = index.session.keys().next().value;

    if (oldest !== undefined) index.session.delete(oldest);
  }

  return entry;
}

function findOutlineView(outline: readonly View[] | undefined, viewId: string): View | undefined {
  const stack = outline ? [...outline] : [];
  const visited = new Set<string>();

  for (let view = stack.pop(); view; view = stack.pop()) {
    if (view.view_id === viewId) return view;
    if (visited.has(view.view_id)) continue;

    visited.add(view.view_id);
    view.children?.forEach((child) => stack.push(child));
  }

  return undefined;
}

/** The name the sources give `viewId`, the outline's first; `undefined` when they do not list it. */
function sourceName(sources: MentionIndexSources, viewId: string): string | undefined {
  const view = findOutlineView(sources.outline, viewId) ?? sources.recent?.find((item) => item.view_id === viewId);

  return view ? view.name ?? '' : undefined;
}

/**
 * Gives the index a workspace's sources, replacing the previous ones; `undefined` for one that has
 * not loaded. Keeps references only. This is what makes the workspace known.
 */
export function setMentionIndexSources(workspaceId: string, sources: MentionIndexSources) {
  const { outline, recent, trash } = sources;
  const index = indexes.get(workspaceId);

  if (index) {
    const current = index.sources;

    if (current.outline === outline && current.recent === recent && current.trash === trash) return;

    index.sources = { outline, recent, trash };
    markChanged(index, true);
    return;
  }

  const created: WorkspaceIndex = {
    sources: { outline, recent, trash },
    session: new Map(),
    viewsVersion: 0,
    version: 0,
  };

  indexes.set(workspaceId, created);
  markChanged(created, true);
}

/** This tab created the view. It is a candidate at once, before the outline lists it. */
export function recordMentionViewCreated(workspaceId: string, view: MentionCreatedView, at = Date.now()) {
  const index = indexes.get(workspaceId);

  if (!index) return;

  const entry = touchSession(index, view.viewId);

  entry.createdAt ??= at;
  entry.created = { layout: view.layout, parentViewId: view.parentViewId, databaseId: view.databaseId };
  entry.name = view.name;
  entry.replacedName = undefined;
  entry.deleted = false;
  markChanged(index, true);
}

/** This tab renamed the view. A name equal to the one already shown changes nothing. */
export function recordMentionViewRenamed(workspaceId: string, viewId: string, name: string, at = Date.now()) {
  const index = indexes.get(workspaceId);

  if (!index) return;

  const listedName = sourceName(index.sources, viewId);

  if (shownName(listedName, index.session.get(viewId)) === name) return;

  const entry = touchSession(index, viewId);

  if (listedName !== undefined) {
    entry.replacedName = listedName;
  } else if (entry.created && !entry.listed) {
    // The sources will first list the creation under its first name.
    entry.replacedName ??= entry.name;
  } else {
    entry.replacedName = undefined;
  }

  entry.name = name;
  entry.renamedAt = at;
  markChanged(index, true);
}

/** This tab moved the view to the trash: it and its subtree leave the candidates at once. */
export function recordMentionViewDeleted(workspaceId: string, viewId: string) {
  const index = indexes.get(workspaceId);

  if (!index || index.session.get(viewId)?.deleted) return;

  touchSession(index, viewId).deleted = true;
  markChanged(index, true);
}

/** This tab restored the view from the trash, or every view when `viewId` is unset. */
export function recordMentionViewRestored(workspaceId: string, viewId?: string) {
  const index = indexes.get(workspaceId);

  if (!index) return;

  let restored = false;
  const restore = (entry: SessionView | undefined) => {
    if (!entry?.deleted) return;

    entry.deleted = false;
    restored = true;
  };

  if (viewId === undefined) index.session.forEach(restore);
  else restore(index.session.get(viewId));
  if (restored) markChanged(index, true);
}

/** This tab opened the view. */
export function recordMentionViewOpened(workspaceId: string, viewId: string, at = Date.now()) {
  const index = indexes.get(workspaceId);

  if (!index) return;

  const entry = touchSession(index, viewId);

  if (entry.openedAt !== undefined && entry.openedAt >= at) return;

  entry.openedAt = at;
  markChanged(index, true);
}

/** The roster the app loaded for a workspace. Kept for workspaces the app has not given the index yet. */
export function recordMentionRoster(workspaceId: string, people: readonly MentionablePerson[]) {
  if (rosters.get(workspaceId) === people) return;

  rosters.set(workspaceId, people);

  const index = indexes.get(workspaceId);

  if (index) markChanged(index, false);
}

/**
 * Forgets one workspace (the app left it), or every workspace and roster (the session ended).
 * Afterwards its snapshot is the empty one, and writes for it are ignored until the app gives its
 * sources again.
 */
export function clearMentionLocalIndex(workspaceId?: string) {
  if (workspaceId !== undefined) {
    if (indexes.delete(workspaceId)) notifyListeners();
    return;
  }

  const hadIndexes = indexes.size > 0;

  indexes.clear();
  rosters.clear();
  if (hadIndexes) notifyListeners();
}

/** Calls `listener` after every change; returns the unsubscribe. For `useSyncExternalStore`. */
export function subscribeMentionLocalIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A workspace's candidates. Built on the first read after a change, then the same object until the
 * next change. A roster change alone keeps the views and their array.
 */
export function getMentionLocalSnapshot(workspaceId: string | undefined): MentionLocalSnapshot {
  const index = workspaceId === undefined ? undefined : indexes.get(workspaceId);

  if (workspaceId === undefined || !index) return EMPTY_MENTION_LOCAL_SNAPSHOT;
  if (index.snapshot?.version === index.version) return index.snapshot;

  if (index.built?.version !== index.viewsVersion) {
    index.built = { version: index.viewsVersion, ...buildViews(index) };
  }

  index.snapshot = Object.freeze({
    workspaceId,
    version: index.version,
    views: index.built.views,
    viewsById: index.built.viewsById,
    people: rosters.get(workspaceId) ?? NO_PEOPLE,
  });
  return index.snapshot;
}

// The index holds the signed-in account's pages and people. Sign-out emits this too.
on(EventType.SESSION_INVALID, () => clearMentionLocalIndex());

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const time = Date.parse(value);

  return Number.isNaN(time) ? undefined : time;
}

function latest(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  return current === undefined || next > current ? next : current;
}

/** Whether a view the sources list can be a candidate, by itself. Trash and parents are checked apart. */
function isCandidateView(view: View): boolean {
  return (
    !isSpaceView(view) &&
    !isEmbeddedView(view) &&
    !isDashboardOwnedView(view) &&
    !view.extra?.row_document &&
    view.extra?.database_row_template !== true
  );
}

/**
 * The database view Search answers for a database layout: the view itself, or a container's first
 * child that is a database view (`database_mention_target_from_view`).
 */
function answeredDatabaseViewId(view: View, databaseId: string | undefined): string | undefined {
  if (!isDatabaseContainer(view)) return view.view_id;

  return view.children?.find((child) => {
    if (!isDatabaseLayout(child.layout) || isDatabaseContainer(child)) return false;

    const childDatabaseId = getDatabaseIdFromExtra(child);

    return !databaseId || !childDatabaseId || childDatabaseId === databaseId;
  })?.view_id;
}

/**
 * The name to show: this tab's name while the sources do not list the view, or still show the name
 * it replaced; else the sources' name (`listedName`, `undefined` when they do not list the view).
 */
function shownName(listedName: string | undefined, entry: SessionView | undefined): string | undefined {
  if (entry?.name === undefined) return listedName;
  if (listedName === undefined || (listedName !== entry.name && listedName === entry.replacedName)) return entry.name;
  return listedName;
}

/**
 * The name to show for a listed view. Once the sources show this tab's name, or another one (a later
 * rename elsewhere), they win for good, and the override is dropped, which changes no output.
 */
function currentName(listedName: string, entry: SessionView | undefined): string {
  const name = shownName(listedName, entry) ?? listedName;

  if (entry && name === listedName) {
    entry.name = undefined;
    entry.replacedName = undefined;
  }

  return name;
}

function listedView(
  view: View,
  parentViewId: string | undefined,
  source: MentionLocalViewSource,
  entry: SessionView | undefined,
  recentView: View | undefined
): BuildingView {
  const viewId = view.view_id;
  const isDatabase = isDatabaseLayout(view.layout);
  const databaseId = isDatabase ? getDatabaseIdFromExtra(view) : undefined;
  const databaseViewId = isDatabase ? answeredDatabaseViewId(view, databaseId) : undefined;

  return {
    viewId,
    name: currentName(view.name ?? '', entry),
    layout: view.layout,
    icon: view.icon ?? null,
    parentViewId,
    isDatabase,
    databaseId,
    databaseViewId,
    navKey: isDatabase ? mentionDatabaseNavKey(databaseId, databaseViewId) : mentionPageNavKey(viewId),
    source,
    createdAt: parseTime(view.created_at),
    lastEditedAt: parseTime(view.last_edited_time),
    lastViewedAt: parseTime(recentView?.last_viewed_at),
    sessionCreatedAt: entry?.createdAt,
    sessionOpenedAt: entry?.openedAt,
    sessionRenamedAt: entry?.renamedAt,
  };
}

function createdView(viewId: string, entry: SessionView, created: SessionCreation): BuildingView {
  const isDatabase = isDatabaseLayout(created.layout);
  // A new database's answered view is unknown until the outline lists its children.
  const databaseId = isDatabase ? created.databaseId : undefined;

  return {
    viewId,
    name: entry.name ?? '',
    layout: created.layout,
    icon: null,
    parentViewId: created.parentViewId,
    isDatabase,
    databaseId,
    databaseViewId: undefined,
    navKey: isDatabase ? mentionDatabaseNavKey(databaseId, undefined) : mentionPageNavKey(viewId),
    source: 'session',
    createdAt: undefined,
    lastEditedAt: undefined,
    lastViewedAt: undefined,
    sessionCreatedAt: entry.createdAt,
    sessionOpenedAt: entry.openedAt,
    sessionRenamedAt: entry.renamedAt,
  };
}

/** A database's own view (a tab) is no candidate; what the user did to it counts for the database. */
function foldIntoDatabase(database: BuildingView, recentView: View | undefined, entry: SessionView | undefined) {
  database.lastViewedAt = latest(database.lastViewedAt, parseTime(recentView?.last_viewed_at));
  database.sessionOpenedAt = latest(database.sessionOpenedAt, entry?.openedAt);
  database.sessionCreatedAt = latest(database.sessionCreatedAt, entry?.createdAt);
}

interface OutlineFrame {
  view: View;
  parentViewId: string | undefined;
  insideDatabase: boolean;
  /** The candidate database the view belongs to, when it is one of a database's own views. */
  database: BuildingView | undefined;
}

/**
 * Flattens the sources into candidates, with this tab's events applied. Also retires session state
 * the sources caught up with (a listed creation, a name, a deletion the trash list shows), which
 * changes no output.
 */
function buildViews(index: WorkspaceIndex): Omit<BuiltViews, 'version'> {
  const { outline, recent, trash } = index.sources;
  const { session } = index;
  const trashed = new Set<string>();
  const recentById = new Map<string, View>();
  // Every view the sources list, candidate or not. A view listed twice is read once.
  const listed = new Map<string, View>();
  const views: BuildingView[] = [];
  const viewsById = new Map<string, BuildingView>();
  const add = (view: BuildingView) => {
    views.push(view);
    viewsById.set(view.viewId, view);
  };

  trash?.forEach((view) => trashed.add(view.view_id));
  recent?.forEach((view) => {
    if (!recentById.has(view.view_id)) recentById.set(view.view_id, view);
  });

  const isRemovedId = (viewId: string) => trashed.has(viewId) || session.get(viewId)?.deleted === true;
  // Whether a view outside the outline is one of a listed database's own views, whose activity
  // then counts for the database.
  const foldsIntoDatabase = (parent: View | undefined, recentView: View | undefined, entry?: SessionView) => {
    if (!parent || !isDatabaseLayout(parent.layout)) return false;

    const database = viewsById.get(parent.view_id);

    if (database) foldIntoDatabase(database, recentView, entry);
    return true;
  };

  // Listing a view settles its session state: a creation is listed from the sources from now on,
  // and a deletion the trash list shows is left to it, so a restore elsewhere shows the view again.
  const settleListed = (viewId: string, entry: SessionView | undefined) => {
    if (!entry) return;

    entry.listed = true;
    if (entry.deleted && trashed.has(viewId)) entry.deleted = false;
  };

  const frames: OutlineFrame[] = [];
  const pushChildren = (
    children: readonly View[] | undefined,
    parentViewId: string | undefined,
    insideDatabase: boolean,
    database: BuildingView | undefined
  ) => {
    if (!children) return;

    for (let i = children.length - 1; i >= 0; i -= 1) {
      frames.push({ view: children[i], parentViewId, insideDatabase, database });
    }
  };

  pushChildren(outline, undefined, false, undefined);
  for (let frame = frames.pop(); frame; frame = frames.pop()) {
    const { view, insideDatabase, database } = frame;
    const viewId = view.view_id;

    if (listed.has(viewId)) continue;
    listed.set(viewId, view);

    const entry = session.get(viewId);
    // Read before settling: a deletion only the session knows still hides the view this time.
    const removed = isRemovedId(viewId);

    settleListed(viewId, entry);
    // Its subtree goes to the trash with it.
    if (removed) continue;

    const recentView = recentById.get(viewId);
    let candidate: BuildingView | undefined;

    if (insideDatabase) {
      if (database) foldIntoDatabase(database, recentView, entry);
    } else if (isCandidateView(view)) {
      candidate = listedView(view, view.parent_view_id ?? frame.parentViewId, 'outline', entry, recentView);
      add(candidate);
    }

    const isDatabase = isDatabaseLayout(view.layout);

    pushChildren(view.children, viewId, insideDatabase || isDatabase, isDatabase ? candidate ?? database : database);
  }

  recent?.forEach((view) => {
    const viewId = view.view_id;

    if (listed.has(viewId)) return;
    listed.set(viewId, view);

    const entry = session.get(viewId);
    const removed = isRemovedId(viewId);
    const parentViewId = view.parent_view_id;
    const parent = parentViewId === undefined ? undefined : listed.get(parentViewId);

    settleListed(viewId, entry);
    if (removed || (parentViewId !== undefined && isRemovedId(parentViewId))) return;
    if (foldsIntoDatabase(parent, view, entry)) return;
    if (isCandidateView(view)) add(listedView(view, parentViewId, 'recent', entry, view));
  });

  session.forEach((entry, viewId) => {
    const { created } = entry;

    if (!created || entry.listed || entry.deleted) return;

    const parentViewId = created.parentViewId;
    const parent = parentViewId === undefined ? undefined : listed.get(parentViewId);

    if (parentViewId !== undefined && isRemovedId(parentViewId)) return;
    if (foldsIntoDatabase(parent, undefined, entry)) return;

    // The server embeds a database created in a document or a row page, and only the outline tells
    // which: until it lists the database, list only one created in a space.
    if (isDatabaseLayout(created.layout) && !(parent && isSpaceView(parent))) return;

    add(createdView(viewId, entry, created));
  });

  return { views, viewsById };
}
