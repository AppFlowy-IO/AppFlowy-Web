/**
 * The mention candidates this tab already holds, per workspace: the views the app has loaded, what
 * this tab did to them, and the roster. The mention picker's local lane reads it (MEN-WEB-09,
 * `mentionLocalLane.ts`, behind the picker's `mentionTypeaheadV2` switch), and so does pick memory's
 * join (MEN-WEB-10).
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
 * it or a name this tab did not send; a deletion hides the view until the trash list shows it.
 *
 * A view the trash list showed and then dropped is gone (deleted for good, or restored where the
 * outline does not list it yet) for the recent views and this tab's creations, subtree included,
 * until the outline lists it again, this tab restores it, or reloaded recent views list it or a
 * view below it. The outline decides for the views it lists, so a restore elsewhere shows them.
 *
 * All of this is settled when the sources change or an event is recorded, never when a snapshot
 * is read, so a snapshot depends only on what was written, in which order.
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

/**
 * At most this many views keep this tab's events per workspace, and as many are remembered as gone
 * from the trash; the least recently touched go first.
 */
export const MENTION_LOCAL_SESSION_LIMIT = 500;

/** At most this many names a view's pending rename keeps for the sources to show before it. */
const STALE_NAME_LIMIT = 5;

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
   * The names the sources may show before they show `name`: the one this tab's renames replaced
   * and the earlier ones it sent (two sends can land within one echo), oldest first. For a creation
   * the sources do not list yet, the name they will first show. Unset when none is known: the
   * sources' name then wins as soon as they list the view.
   */
  staleNames?: readonly string[];
  /** Moved to trash in this tab: hidden until the trash list shows it or this tab restores it. */
  deleted?: boolean;
  /**
   * The views the outline listed below it when this tab moved it to the trash. Where the outline no
   * longer places them (recent views, creations), they stay hidden while the view is: in the trash,
   * deleted here or gone from the trash, and not listed by the outline outside the trash.
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
  /**
   * Views the trash list showed and then dropped, least recently first: deleted for good, or
   * restored where the outline does not list them yet. Hidden from the recent views and this tab's
   * creations until the outline lists them, this tab restores them, or reloaded recent views list
   * them or a view below them.
   */
  goneFromTrash: Set<string>;
  /** Views this tab restored while the trash list showed them: its dropping them is no deletion. */
  restoring: Set<string>;
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

/** The trash list dropped the view without this tab restoring it. */
function rememberGoneFromTrash(index: WorkspaceIndex, viewId: string) {
  const gone = index.goneFromTrash;

  gone.delete(viewId);
  gone.add(viewId);
  if (gone.size > MENTION_LOCAL_SESSION_LIMIT) {
    const oldest = gone.values().next().value;

    if (oldest !== undefined) gone.delete(oldest);
  }
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

/** The ids of every view below `views` (copies of one outline view) in the outline. */
function subtreeIds(views: readonly (View | undefined)[]): Set<string> {
  const ids = new Set<string>();

  views.forEach((view) =>
    walkOutline(view?.children, (child) => {
      ids.add(child.view_id);
      return false;
    })
  );
  views.forEach((view) => {
    if (view) ids.delete(view.view_id);
  });
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

/**
 * `names` without `latest` and repeats, oldest first, keeping the newest `STALE_NAME_LIMIT`; unset
 * when none is left.
 */
function staleNamesOf(names: readonly string[], latest: string): readonly string[] | undefined {
  const kept: string[] = [];

  for (let i = names.length - 1; i >= 0 && kept.length < STALE_NAME_LIMIT; i -= 1) {
    if (names[i] !== latest && !kept.includes(names[i])) kept.unshift(names[i]);
  }

  return kept.length > 0 ? kept : undefined;
}

/** The trash list shows the view: it hides the view from now on, and decides about a creation. */
function settleTrashed(entry: SessionView) {
  entry.deleted = false;
  if (entry.created) entry.listed = true;
}

/**
 * The outline or the recent views list the view under `listedName`. They decide about a creation
 * from now on, and their name wins for good once it is this tab's latest or one this tab did not
 * send. Dropping the override then changes no output.
 */
function settleListed(entry: SessionView, listedName: string) {
  if (entry.created) entry.listed = true;
  if (entry.name !== undefined && shownName(listedName, entry) === listedName) {
    entry.name = undefined;
    entry.staleNames = undefined;
  }
}

/** Settles one view's events against the sources the index holds now. */
function settleWithSources(sources: MentionIndexSources, viewId: string, entry: SessionView) {
  if (isInTrash(sources, viewId)) settleTrashed(entry);

  const listedName = sourceName(sources, viewId);

  if (listedName !== undefined) settleListed(entry, listedName);
}

/**
 * A changed trash list: a deletion or creation waiting for it that it shows is settled, and a view
 * it dropped is gone unless this tab restored it.
 */
function settleTrash(
  index: WorkspaceIndex,
  previousTrash: readonly View[] | undefined,
  waiting: Map<string, SessionView>
) {
  const { goneFromTrash, restoring } = index;
  const shown = new Set<string>();

  index.sources.trash?.forEach((view) => {
    const entry = waiting.get(view.view_id);

    shown.add(view.view_id);
    goneFromTrash.delete(view.view_id);
    if (entry) settleTrashed(entry);
  });
  previousTrash?.forEach((view) => {
    if (shown.has(view.view_id) || restoring.delete(view.view_id)) return;
    rememberGoneFromTrash(index, view.view_id);
  });
}

/**
 * Retires what the new sources caught up with:
 * - a changed trash list: a deletion or creation it shows, and the views it dropped (gone);
 * - reloaded recent views: the server leaves views in or below the trash, and deleted ones, out of
 *   them, so a view they list and its parent are not gone;
 * - a changed outline: the gone views it lists again;
 * - a changed outline or recent views: the creations and renames they list.
 * Only changed sources are read, the outline only while a view waits for it, in one walk per change.
 */
function settleSession(index: WorkspaceIndex, previous: MentionIndexSources) {
  const { session, sources, goneFromTrash } = index;
  const outlineChanged = sources.outline !== previous.outline;
  const recentChanged = sources.recent !== previous.recent;
  const waitingForTrash = new Map<string, SessionView>();
  const waitingForListing = new Map<string, SessionView>();

  session.forEach((entry, viewId) => {
    const pendingCreation = entry.created !== undefined && !entry.listed;

    if (entry.deleted || pendingCreation) waitingForTrash.set(viewId, entry);
    if (pendingCreation || entry.staleNames !== undefined) waitingForListing.set(viewId, entry);
  });

  if (sources.trash !== previous.trash) settleTrash(index, previous.trash, waitingForTrash);
  if (recentChanged && goneFromTrash.size > 0) {
    sources.recent?.forEach((view) => {
      goneFromTrash.delete(view.view_id);
      if (view.parent_view_id) goneFromTrash.delete(view.parent_view_id);
    });
  }

  const findGone = outlineChanged && goneFromTrash.size > 0;
  const findNames = waitingForListing.size > 0 && (outlineChanged || recentChanged);

  if (!findGone && !findNames) return;

  // The names the sources give the waiting views, the outline's first.
  const names = new Map<string, string>();
  const take = (view: View) => {
    if (waitingForListing.has(view.view_id) && !names.has(view.view_id)) names.set(view.view_id, view.name ?? '');
  };

  walkOutline(sources.outline, (view) => {
    if (findGone) goneFromTrash.delete(view.view_id);
    if (findNames) take(view);
    return (!findGone || goneFromTrash.size === 0) && (!findNames || names.size === waitingForListing.size);
  });
  if (!findNames) return;

  sources.recent?.forEach(take);
  names.forEach((name, viewId) => {
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
    goneFromTrash: new Set(),
    restoring: new Set(),
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
  entry.staleNames = undefined;
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
  const shown = shownName(listedName, index.session.get(viewId));

  if (shown === name) return;

  const entry = touchSession(index, viewId);
  // Until they show `name`, the sources may show what they show now, or one of this tab's names
  // they have not caught up with: the pending one, and those it kept (a creation's first name).
  const pending = entry.name !== undefined && shown === entry.name ? [...(entry.staleNames ?? []), entry.name] : [];

  entry.staleNames = staleNamesOf(listedName === undefined ? pending : [...pending, listedName], name);
  entry.name = name;
  entry.renamedAt = at;
  markChanged(index, true);
}

/**
 * This tab moved the view to the trash: it and its subtree leave the candidates at once, and the
 * subtree the outline showed stays out of the other lanes once the outline drops it. `outlineView`
 * is the view as the caller's outline held it before the move: a folder notification can drop it
 * from the index's outline while the move is in flight.
 */
export function recordMentionViewDeleted(workspaceId: string, viewId: string, outlineView?: View | null) {
  const index = indexes.get(workspaceId);

  if (!index || index.session.get(viewId)?.deleted) return;

  index.restoring.delete(viewId);

  const before = outlineView?.view_id === viewId ? outlineView : undefined;
  const subtree = subtreeIds([before, findOutlineView(index.sources.outline, viewId)]);
  // A trash refresh that won the race hides the view already. A deletion recorded now would never
  // see the trash list change to show it, and would outlive a restore elsewhere.
  const inTrash = isInTrash(index.sources, viewId);

  if (inTrash && subtree.size === 0) return;

  const entry = touchSession(index, viewId);

  if (inTrash) settleTrashed(entry);
  else entry.deleted = true;
  if (subtree.size > 0) entry.deletedSubtree = subtree;
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

  // The trash list dropping what this tab restored is no deletion; a trash refresh that won the
  // race already counted the view as gone. Restoring everything brings back nothing deleted before.
  if (viewId === undefined) {
    index.sources.trash?.forEach((view) => index.restoring.add(view.view_id));
  } else if (isInTrash(index.sources, viewId)) {
    index.restoring.add(viewId);
  } else if (index.goneFromTrash.delete(viewId)) {
    restored = true;
  }

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
 * The name to show: this tab's name while the sources do not list the view, or still show a name
 * it replaced or sent before; else the sources' name (`listedName`, `undefined` when they do not
 * list the view).
 */
function shownName(listedName: string | undefined, entry: SessionView | undefined): string | undefined {
  if (entry?.name === undefined) return listedName;
  if (listedName === undefined || entry.staleNames?.includes(listedName)) return entry.name;
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
  const { session, goneFromTrash } = index;
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

  // The subtrees this tab saw when it moved a view to the trash, while that view is hidden: in the
  // trash, deleted here or gone from the trash, and not listed by the outline outside the trash.
  const deletedSubtrees: ReadonlySet<string>[] = [];

  session.forEach((entry, viewId) => {
    if (!entry.deletedSubtree || (outlineViews.has(viewId) && !removedInOutline.has(viewId))) return;
    if (!trashed.has(viewId) && !entry.deleted && !goneFromTrash.has(viewId)) return;
    deletedSubtrees.push(entry.deletedSubtree);
  });

  const inDeletedSubtree = (viewId: string) => deletedSubtrees.some((ids) => ids.has(viewId));
  const parentOf = (viewId: string) =>
    recentById.get(viewId)?.parent_view_id ?? session.get(viewId)?.created?.parentViewId;
  const verdicts = new Map<string, boolean>();
  // Whether a view is removed. The outline decides for the views it lists. Any other view is
  // removed in the trash, gone from it, when deleted in this tab or in a subtree it deleted, or
  // below a removed view, following the parents the recent views and this tab's creations give.
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
      if (isTrashedOrDeleted(current) || goneFromTrash.has(current) || inDeletedSubtree(current)) {
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
