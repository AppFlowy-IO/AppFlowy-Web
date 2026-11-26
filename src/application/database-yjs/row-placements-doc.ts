/**
 * Anchored views in a Database document: who is anchored, what a view's rows are, and the
 * writes that keep an anchored view right. The rule itself is in `row-placements.ts`.
 *
 * Every function that writes expects to run inside a transaction of the document.
 */
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import {
  anchoredOrder,
  KeyWriter,
  placementAt,
  placementForMove,
  repairAfterRemoval,
  RowPlacement,
  RowPlacements,
  RowTarget,
} from '@/application/database-yjs/row-placements';
import { YDatabase, YDatabaseRowPlacements, YDatabaseView, YjsDatabaseKey } from '@/application/types';

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

/**
 * The canonical rows of the Database a view belongs to: the rows of its storage view, each id
 * once, trashed rows included. `undefined` when the Database has no storage view, which is the
 * case for a legacy Database; such a Database has no anchored view.
 */
export function canonicalRowOrders(
  database: YDatabase | undefined,
  view: YDatabaseView | undefined
): RowOrderEntry[] | undefined {
  const databaseId = view?.get(YjsDatabaseKey.database_id);

  if (!database || !databaseId) return undefined;

  const stored = database
    .get(YjsDatabaseKey.views)
    ?.get(storageViewId(databaseId))
    ?.get(YjsDatabaseKey.row_orders);

  if (!stored) return undefined;

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
