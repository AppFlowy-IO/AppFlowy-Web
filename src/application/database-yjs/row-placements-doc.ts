/**
 * Anchored views in a Database document: who is anchored, what a view's rows are, and the
 * writes that keep an anchored view right. The rule itself is in `row-placements.ts`.
 *
 * Every function that writes expects to run inside a transaction of the document.
 */
import { v5 as uuidv5, validate as isUuid } from 'uuid';
import * as Y from 'yjs';

import {
  anchoredOrder,
  KeyWriter,
  placementAt,
  placementForMove,
  placementsForOrder,
  repairAfterRemoval,
  RowPlacement,
  RowPlacements,
  RowTarget,
} from '@/application/database-yjs/row-placements';
import {
  YDatabase,
  YDatabaseRowOrders,
  YDatabaseRowPlacements,
  YDatabaseView,
  YjsDatabaseKey,
} from '@/application/types';

/** A row as a view's row order names it. */
export interface RowOrderEntry {
  id: string;
  height: number;
  is_deleted?: boolean;
}

/**
 * The id of the view that stores the rows of a Database. Every modern Database has it, and no
 * client shows it as a tab. An anchored view reads its rows and their default order from it.
 */
export function storageViewId(databaseId: string): string {
  return uuidv5('inline_view_id', databaseId);
}

/**
 * Whether a view is anchored: its map holds the placements key, whatever is stored under it.
 * The inline view never is, since it holds the rows the others read.
 */
export function isAnchoredView(view: YDatabaseView | undefined): boolean {
  if (!view) return false;
  return view.has(YjsDatabaseKey.row_placements) && !view.get(YjsDatabaseKey.is_inline);
}

/** The placements stored on a view. Entries that are not well-formed are left out. */
export function readRowPlacements(view: YDatabaseView | undefined): RowPlacements {
  const placements: RowPlacements = new Map();
  const stored = view?.get(YjsDatabaseKey.row_placements) as unknown;

  if (!(stored instanceof Y.Map)) return placements;

  stored.forEach((value: unknown, rowId: string) => {
    if (!value || typeof value !== 'object') return;

    const { a: anchor, p: key } = value as { a?: unknown; p?: unknown };

    if (typeof anchor !== 'string' || !(key instanceof Uint8Array)) return;
    placements.set(rowId, { anchor: anchor === '' ? null : anchor, key });
  });

  return placements;
}

/** The Database a view is stored in, for the places that hold only the view. */
export function databaseOfView(view: YDatabaseView | undefined): YDatabase | undefined {
  const database = (view as unknown as Y.Map<unknown> | undefined)?.parent?.parent;

  return database instanceof Y.Map ? (database as unknown as YDatabase) : undefined;
}

/**
 * The storage view of the Database a view belongs to. `undefined` for a legacy Database, which
 * has none; such a Database has no anchored view.
 */
function storageViewOf(database: YDatabase | undefined, view: YDatabaseView | undefined): YDatabaseView | undefined {
  const databaseId = view?.get(YjsDatabaseKey.database_id);

  if (!database || !databaseId || !isUuid(databaseId)) return undefined;

  return database.get(YjsDatabaseKey.views)?.get(storageViewId(databaseId));
}

/**
 * The storage view's row list for the Database a view belongs to. `undefined` when the Database
 * has no storage view, and when its storage view has no row list yet.
 */
export function storageRowOrders(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined
): YDatabaseRowOrders | undefined {
  return storageViewOf(database, view)?.get(YjsDatabaseKey.row_orders);
}

/**
 * The array that names the rows a view holds, for the places that need the rows but not their
 * order (counts, loading, membership): the view's own array, or the storage view's when the view
 * is anchored, since an anchored view holds exactly the rows of the Database.
 */
export function viewMembershipRowOrders(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined
): YDatabaseRowOrders | undefined {
  const own = view?.get(YjsDatabaseKey.row_orders);

  if (!isAnchoredView(view)) return own;

  const storage = storageViewOf(database, view);

  // Without a storage view the view is read as it is stored.
  return storage ? storage.get(YjsDatabaseKey.row_orders) : own;
}

/**
 * The canonical rows of the Database a view belongs to: the rows of its storage view, each id
 * once, trashed rows included. `undefined` when the Database has no storage view. A storage view
 * that has no row list yet, as in a Database that never had a row, has no rows.
 */
export function canonicalRowOrders(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined
): RowOrderEntry[] | undefined {
  const storage = storageViewOf(database, view);

  if (!storage) return undefined;

  const stored = storage.get(YjsDatabaseKey.row_orders);

  if (!stored) return [];

  // The first entry of an id wins, as it does wherever the storage view's rows are looked up.
  const seen = new Set<string>();

  return (stored.toArray() as RowOrderEntry[]).filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/**
 * The rows a view holds, trashed rows included: its own array in array mode, the canonical rows
 * in placement order in anchored mode. An anchored view's own array is not read: it is empty,
 * apart from rows an older client inserted.
 */
export function viewRowOrderEntries(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined
): RowOrderEntry[] | undefined {
  if (!view) return undefined;

  if (isAnchoredView(view)) {
    const canonical = canonicalRowOrders(database, view);

    if (canonical) return anchoredOrder(canonical, readRowPlacements(view));
  }

  return view.get(YjsDatabaseKey.row_orders)?.toArray() as RowOrderEntry[] | undefined;
}

/**
 * The rows a view holds, as plain values, for the places that read a view's `row_orders` with
 * `toJSON()`. A view in array mode is read exactly that way; an anchored view gives the
 * canonical rows in placement order.
 */
export function viewRowOrdersJSON(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined
): RowOrderEntry[] | undefined {
  if (isAnchoredView(view)) {
    const canonical = canonicalRowOrders(database, view);

    if (canonical) return anchoredOrder(canonical, readRowPlacements(view));
  }

  return view?.get(YjsDatabaseKey.row_orders)?.toJSON() as RowOrderEntry[] | undefined;
}

/**
 * Calls `handler` once for every transaction that can change the rows a view holds or their
 * order: a change of the view's own array, of its placements, or, while the view is anchored, of
 * the storage view's rows. It follows a view that changes mode. Returns the function that stops
 * it.
 */
export function observeViewRowOrders(
  database: YDatabase | undefined,
  view: YDatabaseView,
  handler: (transaction: Y.Transaction) => void
): () => void {
  let lastTransaction: Y.Transaction | undefined;
  let detach = () => undefined as void;

  const notify = (_events: unknown, transaction: Y.Transaction) => {
    // One transaction usually changes several of the observed parts.
    if (lastTransaction === transaction) return;
    lastTransaction = transaction;
    handler(transaction);
  };

  const attach = () => {
    detach();

    const own = view.get(YjsDatabaseKey.row_orders);
    const stored = view.get(YjsDatabaseKey.row_placements) as unknown;
    const placements = stored instanceof Y.Map ? stored : undefined;
    const canonical = isAnchoredView(view) ? storageRowOrders(database, view) : undefined;
    const storage = canonical && canonical !== own ? canonical : undefined;

    own?.observeDeep(notify);
    placements?.observeDeep(notify);
    storage?.observeDeep(notify);
    detach = () => {
      own?.unobserveDeep(notify);
      placements?.unobserveDeep(notify);
      storage?.unobserveDeep(notify);
    };
  };

  const handleViewChange = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
    if (!event.keysChanged.has(YjsDatabaseKey.row_orders) && !event.keysChanged.has(YjsDatabaseKey.row_placements)) {
      return;
    }

    attach();
    notify(undefined, transaction);
  };

  const viewMap = view as unknown as Y.Map<unknown>;

  attach();
  viewMap.observe(handleViewChange);
  return () => {
    viewMap.unobserve(handleViewChange);
    detach();
  };
}

function keyWriter(view: YDatabaseView): KeyWriter | undefined {
  const doc = view.doc;

  if (!doc) return undefined;
  return { client: BigInt(doc.clientID), clock: Y.getState(doc.store, doc.clientID) };
}

function placementsMap(view: YDatabaseView): YDatabaseRowPlacements {
  const stored = view.get(YjsDatabaseKey.row_placements) as unknown;

  if (stored instanceof Y.Map) return stored as YDatabaseRowPlacements;

  const created = new Y.Map() as YDatabaseRowPlacements;

  view.set(YjsDatabaseKey.row_placements, created);
  return created;
}

function writePlacement(view: YDatabaseView, rowId: string, placement: RowPlacement) {
  placementsMap(view).set(rowId, { a: placement.anchor ?? '', p: placement.key });
}

/**
 * Drags a row to the place of another row in an anchored view: a row moved towards the end
 * lands right after `toId`, a row moved towards the start right before it. It writes one
 * placement. Returns whether both rows are rows of the Database.
 */
export function moveRowInAnchoredView(
  database: YDatabase | undefined,
  view: YDatabaseView,
  fromId: string,
  toId: string
): boolean {
  const canonical = canonicalRowOrders(database, view);
  const writer = keyWriter(view);

  if (!canonical || !writer) return false;
  if (!canonical.some((row) => row.id === fromId) || !canonical.some((row) => row.id === toId)) return false;

  const placement = placementForMove(canonical, readRowPlacements(view), fromId, toId, writer);

  if (placement) writePlacement(view, fromId, placement);
  return true;
}

/**
 * Puts a row at a position in an anchored view, after the row joined the Database. Nothing is
 * written when the row's canonical place already is that position. A target row the view lacks
 * means the end, as it does in an array. Returns whether a placement was written.
 */
export function placeRowInAnchoredView(
  database: YDatabase | undefined,
  view: YDatabaseView,
  rowId: string,
  target: RowTarget
): boolean {
  const canonical = canonicalRowOrders(database, view);
  const writer = keyWriter(view);

  if (!canonical || !writer) return false;

  const named = 'row' in target && !canonical.some((row) => row.id === target.row) ? ({ at: 'end' } as RowTarget) : target;
  const placement = placementAt(canonical, readRowPlacements(view), rowId, named, writer);

  if (!placement) return false;
  writePlacement(view, rowId, placement);
  return true;
}

/**
 * Keeps the other rows of every anchored view in place when rows are deleted for good. Call it
 * before the rows are removed from the storage view: rows that were moved next to a removed row
 * move to the slot before it, and the removed rows' own placements go away.
 */
export function repairAnchoredViewsBeforeRemoval(database: YDatabase | undefined, removedRowIds: string[]) {
  const views = database?.get(YjsDatabaseKey.views);

  if (!views || removedRowIds.length === 0) return;

  const removed = new Set(removedRowIds);

  views.forEach((view) => {
    if (!isAnchoredView(view)) return;

    const placements = readRowPlacements(view);
    const canonical = canonicalRowOrders(database, view);
    const writer = keyWriter(view);

    if (placements.size === 0 || !canonical || !writer) return;

    const repair = repairAfterRemoval(canonical, placements, removed, writer);
    const stored = placementsMap(view);

    repair.remove.forEach((rowId) => stored.delete(rowId));
    repair.write.forEach(([rowId, placement]) => writePlacement(view, rowId, placement));
  });
}

/** Gives `target` the placements of `source`, so that a copy of an anchored view shows its order. */
export function copyRowPlacements(source: YDatabaseView, target: YDatabaseView) {
  const stored = placementsMap(target);

  readRowPlacements(source).forEach((placement, rowId) => {
    stored.set(rowId, { a: placement.anchor ?? '', p: placement.key });
  });
}

/**
 * Moves a row of an anchored view right after `previousRowId`, or to the start when no such row
 * is named or the Database lacks it, which is what the array move of a drag does. It writes one
 * placement. Returns whether the row is a row of the Database.
 */
export function reorderRowInAnchoredView(
  database: YDatabase | undefined,
  view: YDatabaseView,
  rowId: string,
  previousRowId: string | undefined
): boolean {
  const canonical = canonicalRowOrders(database, view);
  const writer = keyWriter(view);

  if (!canonical || !writer || !canonical.some((row) => row.id === rowId)) return false;

  const target: RowTarget =
    previousRowId !== undefined && canonical.some((row) => row.id === previousRowId)
      ? { at: 'after', row: previousRowId }
      : { at: 'start' };
  const placement = placementAt(canonical, readRowPlacements(view), rowId, target, writer);

  if (placement) writePlacement(view, rowId, placement);
  return true;
}

/**
 * Makes an anchored view show the rows named by `rowIds` in that order. Rows of the Database
 * that `rowIds` leaves out keep their canonical place, and ids that are not rows of the Database
 * are ignored, as the server does when it creates a view with an order. The view's placements
 * are replaced. Returns whether the view could be written.
 */
export function setAnchoredViewOrder(database: YDatabase | undefined, view: YDatabaseView, rowIds: string[]): boolean {
  const canonical = canonicalRowOrders(database, view);
  const writer = keyWriter(view);

  if (!canonical || !writer) return false;

  const known = new Set(canonical.map((row) => row.id));
  const listed: string[] = [];
  const seen = new Set<string>();

  rowIds.forEach((rowId) => {
    if (!known.has(rowId) || seen.has(rowId)) return;
    seen.add(rowId);
    listed.push(rowId);
  });

  // The listed rows take, in their order, the canonical places of the listed rows.
  let next = 0;
  const target = canonical.map((row) => (seen.has(row.id) ? listed[next++] : row.id));
  const placements = placementsForOrder(canonical, target, writer);

  if (!placements) return false;

  const stored = placementsMap(view);

  Array.from(stored.keys()).forEach((rowId) => stored.delete(rowId));
  placements.forEach(([rowId, placement]) => writePlacement(view, rowId, placement));
  return true;
}

/**
 * Rewrites every anchored view of a Database in array mode: the view's own array gets its rows
 * in its order, and the placements go away. For copies that readers of any age get, such as a
 * published page; never for the live document. Returns how many views it rewrote.
 */
export function convertAnchoredViewsToArray(database: YDatabase | undefined): number {
  const views = database?.get(YjsDatabaseKey.views);
  let converted = 0;

  views?.forEach((view) => {
    if (!isAnchoredView(view)) return;

    const rows = viewRowOrderEntries(database, view) ?? [];
    const own = view.get(YjsDatabaseKey.row_orders);

    (view as unknown as Y.Map<unknown>).delete(YjsDatabaseKey.row_placements);
    if (own) {
      own.delete(0, own.length);
      own.push(rows.map((row) => ({ ...row })));
    } else {
      const created = new Y.Array() as YDatabaseRowOrders;

      created.push(rows.map((row) => ({ ...row })));
      view.set(YjsDatabaseKey.row_orders, created);
    }

    converted += 1;
  });

  return converted;
}
