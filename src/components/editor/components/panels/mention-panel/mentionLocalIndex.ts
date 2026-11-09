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
 * included: below a trashed view in the outline, below one through the parents of recent views
 * and creations, and in the subtree the outline showed when this tab moved a view to the trash.
 *
 * This tab's events show at once and give way to the sources once they catch up: a creation is
 * listed until the outline, the recent views or the trash list it; a rename shows until they show
 * it or a later name; a deletion hides the view until the trash list shows it. This is settled
 * when the sources change or an event is recorded, never when a snapshot is read, so a snapshot
 * depends only on what was written, in which order.
 *
 * Limits:
 * - The outline covers six levels (`?depth=6`) and lazily loaded subtrees. Deeper pages count only
 *   once expanded, or while they are among the recent views.
 * - Recent views load lazily (the sidebar's Recent section, search), so `lastViewedAt` may be
 *   missing. The index never fetches.
 * - The trash list carries no subtree. Once the outline has dropped a page that another tab or
 *   user moved to the trash, a recent view two or more levels below it stays listed until the
 *   recent views reload, unless the recent views' own parents lead to the trashed page.
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
  /**
   * The views the outline listed below it when this tab moved it to the trash. Where the outline no
   * longer places them (recent views, creations), they stay hidden until the outline lists the view
   * again outside the trash, or this tab restores it.
   */
  deletedSubtree?: ReadonlySet<string>;
  /** Set for this tab's creations, which are listed from here until the sources list them. */
  created?: SessionCreation;
  /**
   * The outline, the recent views or the trash have listed the view, so a creation is no longer
   * listed from the session.
   */
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

/** Visits outline views depth first, each id once, until `visit` returns true. */
function walkOutline(views: readonly View[] | undefined, visit: (view: View) => boolean) {
  const stack = views ? [...views].reverse() : [];
  const visited = new Set<string>();

  for (let view = stack.pop(); view; view = stack.pop()) {
    if (visited.has(view.view_id)) continue;

    visited.add(view.view_id);
    if (visit(view)) return;

    const children = view.children ?? [];

    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
}

function findOutlineView(outline: readonly View[] | undefined, viewId: string): View | undefined {
  let found: View | undefined;

  walkOutline(outline, (view) => {
    if (view.view_id === viewId) found = view;
    return found !== undefined;
  });
  return found;
}

/** The ids of every view below `view` in the outline. */
function subtreeIds(view: View): Set<string> {
  const ids = new Set<string>();

  walkOutline(view.children, (child) => {
    ids.add(child.view_id);
    return false;
  });
  ids.delete(view.view_id);
  return ids;
}

function isInTrash(sources: MentionIndexSources, viewId: string): boolean {
  return sources.trash?.some((view) => view.view_id === viewId) === true;
}

/** The name the sources give `viewId`, the outline's first; `undefined` when they do not list it. */
function sourceName(sources: MentionIndexSources, viewId: string): string | undefined {
  const view = findOutlineView(sources.outline, viewId) ?? sources.recent?.find((item) => item.view_id === viewId);

  return view ? view.name ?? '' : undefined;
}

/** The names the sources give each of `entries`' views that they list, the outline's first. */
function sourceNames(sources: MentionIndexSources, entries: ReadonlyMap<string, SessionView>): Map<string, string> {
  const names = new Map<string, string>();
  const take = (view: View) => {
    if (entries.has(view.view_id) && !names.has(view.view_id)) names.set(view.view_id, view.name ?? '');
  };

  walkOutline(sources.outline, (view) => {
    take(view);
    return names.size === entries.size;
  });
  sources.recent?.forEach(take);
  return names;
}

/** The trash list shows the view: it hides the view from now on, and decides about a creation. */
function settleTrashed(entry: SessionView) {
  entry.deleted = false;
  if (entry.created) entry.listed = true;
}

/**
 * The outline or the recent views list the view under `listedName`. They decide about a creation
 * from now on, and their name wins for good once it is this tab's or a later one. Dropping the
 * override then changes no output.
 */
function settleListed(entry: SessionView, listedName: string) {
  if (entry.created) entry.listed = true;
  if (entry.name !== undefined && shownName(listedName, entry) === listedName) {
    entry.name = undefined;
    entry.replacedName = undefined;
  }
}

/** Settles one view's events against the sources the index holds now. */
function settleWithSources(sources: MentionIndexSources, viewId: string, entry: SessionView) {
  if (isInTrash(sources, viewId)) settleTrashed(entry);

  const listedName = sourceName(sources, viewId);

  if (listedName !== undefined) settleListed(entry, listedName);
}

/**
 * Retires the events the new sources caught up with: a deletion or creation the new trash list
 * shows, and a creation or rename the outline or the recent views list. Only a changed trash list
 * is read, and the outline only while a creation or rename waits for it (once per change).
 */
function settleSession(index: WorkspaceIndex, previous: MentionIndexSources) {
  const { session, sources } = index;
  const waitingForTrash = new Map<string, SessionView>();
  const waitingForListing = new Map<string, SessionView>();

  session.forEach((entry, viewId) => {
    const pendingCreation = entry.created !== undefined && !entry.listed;

    if (entry.deleted || pendingCreation) waitingForTrash.set(viewId, entry);
    if (pendingCreation || entry.replacedName !== undefined) waitingForListing.set(viewId, entry);
  });

  if (waitingForTrash.size > 0 && sources.trash !== previous.trash && sources.trash?.length) {
    sources.trash.forEach((view) => {
      const entry = waitingForTrash.get(view.view_id);

      if (entry) settleTrashed(entry);
    });
  }

  if (waitingForListing.size === 0) return;
  if (sources.outline === previous.outline && sources.recent === previous.recent) return;

  sourceNames(sources, waitingForListing).forEach((name, viewId) => {
    const entry = waitingForListing.get(viewId);

    if (entry) settleListed(entry, name);
  });
}

/**
 * Gives the index a workspace's sources, replacing the previous ones; `undefined` for one that has
 * not loaded. Keeps references, and settles this tab's events the new sources caught up with. This
 * is what makes the workspace known.
 */
export function setMentionIndexSources(workspaceId: string, sources: MentionIndexSources) {
  const { outline, recent, trash } = sources;
  const index = indexes.get(workspaceId);

  if (index) {
    const previous = index.sources;

    if (previous.outline === outline && previous.recent === recent && previous.trash === trash) return;

    index.sources = { outline, recent, trash };
    settleSession(index, previous);
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
  // The sources may list it already: a default creation resolves once the outline shows the page.
  settleWithSources(index.sources, view.viewId, entry);
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

/**
 * This tab moved the view to the trash: it and its subtree leave the candidates at once, and the
 * subtree the outline shows now stays out of the other lanes once the outline drops it.
 */
export function recordMentionViewDeleted(workspaceId: string, viewId: string) {
  const index = indexes.get(workspaceId);

  if (!index || index.session.get(viewId)?.deleted) return;

  const outlineView = findOutlineView(index.sources.outline, viewId);
  const subtree = outlineView?.children?.length ? subtreeIds(outlineView) : undefined;
  // A trash refresh that won the race hides the view already. A deletion recorded now would never
  // see the trash list change to show it, and would outlive a restore elsewhere.
  const inTrash = isInTrash(index.sources, viewId);

  if (inTrash && !subtree?.size) return;

  const entry = touchSession(index, viewId);

  if (inTrash) settleTrashed(entry);
  else entry.deleted = true;
  if (subtree?.size) entry.deletedSubtree = subtree;
  markChanged(index, true);
}

/** This tab restored the view from the trash, or every view when `viewId` is unset. */
export function recordMentionViewRestored(workspaceId: string, viewId?: string) {
  const index = indexes.get(workspaceId);

  if (!index) return;

  let restored = false;
  const restore = (entry: SessionView | undefined) => {
    if (!entry || (!entry.deleted && !entry.deletedSubtree)) return;

    entry.deleted = false;
    entry.deletedSubtree = undefined;
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

/** The name to show for a listed view (see `shownName`). */
function displayName(listedName: string, entry: SessionView | undefined): string {
  return shownName(listedName, entry) ?? listedName;
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
    name: displayName(view.name ?? '', entry),
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
  /** Below a view in the trash or deleted in this tab: walked, never a candidate. */
  insideRemoved: boolean;
}

/**
 * Flattens the sources into candidates, with this tab's events applied. It only reads the session:
 * what the sources caught up with was settled when they changed.
 */
function buildViews(index: WorkspaceIndex): Omit<BuiltViews, 'version'> {
  const { outline, recent, trash } = index.sources;
  const { session } = index;
  const trashed = new Set<string>();
  const recentById = new Map<string, View>();
  // Every view the outline lists, candidate or not; a view listed twice is read once. Those it
  // removes: in the trash or deleted in this tab, or below such a view.
  const outlineViews = new Map<string, View>();
  const removedInOutline = new Set<string>();
  // The recent views the outline does not list, as far as they were read.
  const recentOnly = new Map<string, View>();
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

  const isTrashedOrDeleted = (viewId: string) => trashed.has(viewId) || session.get(viewId)?.deleted === true;
  const sourceView = (viewId: string) => outlineViews.get(viewId) ?? recentOnly.get(viewId);
  // Whether a view outside the outline is one of a listed database's own views, whose activity
  // then counts for the database.
  const foldsIntoDatabase = (parent: View | undefined, recentView: View | undefined, entry?: SessionView) => {
    if (!parent || !isDatabaseLayout(parent.layout)) return false;

    const database = viewsById.get(parent.view_id);

    if (database) foldIntoDatabase(database, recentView, entry);
    return true;
  };

  const frames: OutlineFrame[] = [];
  const pushChildren = (
    children: readonly View[] | undefined,
    parentViewId: string | undefined,
    insideDatabase: boolean,
    database: BuildingView | undefined,
    insideRemoved: boolean
  ) => {
    if (!children) return;

    for (let i = children.length - 1; i >= 0; i -= 1) {
      frames.push({ view: children[i], parentViewId, insideDatabase, database, insideRemoved });
    }
  };

  pushChildren(outline, undefined, false, undefined, false);
  for (let frame = frames.pop(); frame; frame = frames.pop()) {
    const { view, insideDatabase, database } = frame;
    const viewId = view.view_id;

    if (outlineViews.has(viewId)) continue;
    outlineViews.set(viewId, view);

    // The trash takes the subtree with it. It is walked anyway, so the other lanes know what it hides.
    if (frame.insideRemoved || isTrashedOrDeleted(viewId)) {
      removedInOutline.add(viewId);
      pushChildren(view.children, viewId, false, undefined, true);
      continue;
    }

    const entry = session.get(viewId);
    const recentView = recentById.get(viewId);
    let candidate: BuildingView | undefined;

    if (insideDatabase) {
      if (database) foldIntoDatabase(database, recentView, entry);
    } else if (isCandidateView(view)) {
      candidate = listedView(view, view.parent_view_id ?? frame.parentViewId, 'outline', entry, recentView);
      add(candidate);
    }

    const isDatabase = isDatabaseLayout(view.layout);

    pushChildren(
      view.children,
      viewId,
      insideDatabase || isDatabase,
      isDatabase ? candidate ?? database : database,
      false
    );
  }

  // The subtrees this tab saw when it moved a view to the trash, unless the outline lists that view
  // again outside the trash.
  const deletedSubtrees: ReadonlySet<string>[] = [];

  session.forEach((entry, viewId) => {
    if (!entry.deletedSubtree || (outlineViews.has(viewId) && !removedInOutline.has(viewId))) return;
    deletedSubtrees.push(entry.deletedSubtree);
  });

  const inDeletedSubtree = (viewId: string) => deletedSubtrees.some((ids) => ids.has(viewId));
  const parentOf = (viewId: string) =>
    recentById.get(viewId)?.parent_view_id ?? session.get(viewId)?.created?.parentViewId;
  const verdicts = new Map<string, boolean>();
  // Whether a view is removed. The outline decides for the views it lists. Any other view is
  // removed in the trash, when deleted in this tab or in a subtree it deleted, or below a removed
  // view, following the parents the recent views and this tab's creations give.
  const isRemovedId = (viewId: string): boolean => {
    const chain = new Set<string>();
    let removed = false;
    let current: string | undefined = viewId;

    while (current !== undefined && !chain.has(current)) {
      const known = verdicts.get(current);

      if (known !== undefined) {
        removed = known;
        break;
      }

      if (outlineViews.has(current)) {
        removed = removedInOutline.has(current);
        break;
      }

      chain.add(current);
      if (isTrashedOrDeleted(current) || inDeletedSubtree(current)) {
        removed = true;
        break;
      }

      current = parentOf(current);
    }

    chain.forEach((id) => verdicts.set(id, removed));
    return removed;
  };

  recent?.forEach((view) => {
    const viewId = view.view_id;

    if (outlineViews.has(viewId) || recentOnly.has(viewId)) return;
    recentOnly.set(viewId, view);
    if (isRemovedId(viewId)) return;

    const entry = session.get(viewId);
    const parentViewId = view.parent_view_id;
    const parent = parentViewId === undefined ? undefined : sourceView(parentViewId);

    if (foldsIntoDatabase(parent, view, entry)) return;
    if (isCandidateView(view)) add(listedView(view, parentViewId, 'recent', entry, view));
  });

  session.forEach((entry, viewId) => {
    const { created } = entry;

    // Listed by the sources, now or before: they decide about it.
    if (!created || entry.listed || outlineViews.has(viewId) || recentOnly.has(viewId)) return;
    if (isRemovedId(viewId)) return;

    const parentViewId = created.parentViewId;
    const parent = parentViewId === undefined ? undefined : sourceView(parentViewId);

    if (foldsIntoDatabase(parent, undefined, entry)) return;

    // The server embeds a database created in a document or a row page, and only the outline tells
    // which: until it lists the database, list only one created in a space.
    if (isDatabaseLayout(created.layout) && !(parent && isSpaceView(parent))) return;

    add(createdView(viewId, entry, created));
  });

  return { views, viewsById };
}
