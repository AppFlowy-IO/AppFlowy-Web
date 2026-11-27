/**
 * Row placements: the order of an anchored Database view.
 *
 * A view normally lists every row of its Database in its own `row_orders` array. An anchored
 * view keeps that array empty. It takes its rows, their soft-delete state and their default
 * order from the Database's storage view, and stores one placement for each row that was moved
 * in it, in a `row_placements` map on the view:
 *
 *   row id -> { a: anchor row id, or '' for the start, p: key bytes }
 *
 * Every canonical row owns the slot right after its canonical place, and one more slot comes
 * before all rows. A placed row sits in the slot of its anchor, ordered inside the slot by its
 * key and then by its id. A row without a placement sits at its canonical place:
 *
 *   order = the start slot
 *         + for each canonical row c: c, unless it is placed + the slot of c
 *
 * A placement counts only while its row and its anchor are canonical rows.
 *
 * This file is the rule itself, on plain values. It must agree with the server's and the
 * desktop's implementation (`libs/collab/src/database/views/row_placements.rs` in AppFlowy
 * Cloud), which is what `__tests__/__fixtures__/row_placement_vectors.json` checks.
 */

/** Where a moved row sits in an anchored view. */
export interface RowPlacement {
  /** The canonical row whose slot holds the row; `null` for the slot before all rows. */
  anchor: string | null;
  /** Orders the rows inside one slot, compared byte by byte. */
  key: Uint8Array;
}

/** The placements of one view, by row id. */
export type RowPlacements = Map<string, RowPlacement>;

/** Identifies one write, so that two devices filling the same gap write different keys. */
export interface KeyWriter {
  client: bigint;
  clock: number;
}

/** Where a row should go, relative to the rows of the view. */
export type RowTarget =
  | { at: 'start' }
  | { at: 'end' }
  | { at: 'before'; row: string }
  | { at: 'after'; row: string };

/** What a permanent delete has to change in a view's placements. */
export interface PlacementRepair {
  /** Rows whose placement goes away. */
  remove: string[];
  /** Rows that move to another slot to keep their place. */
  write: Array<[string, RowPlacement]>;
}

interface RowLike {
  id: string;
}

/** The last byte of every key, so that no key ends in zero and a key always fits below it. */
const KEY_END = 1;

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);

  for (let index = 0; index < shared; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }

  return left.length - right.length;
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** One step above `lower`, so appending to a slot lengthens the key by one byte per 255 rows. */
function prefixAbove(lower: Uint8Array): number[] {
  const prefix: number[] = [];

  for (const byte of lower) {
    if (byte < 0xff) {
      prefix.push(byte + 1);
      return prefix;
    }

    prefix.push(byte);
  }

  prefix.push(0x80);
  return prefix;
}

/** One step below `upper`. */
function prefixBelow(upper: Uint8Array): number[] {
  const prefix: number[] = [];

  for (const byte of upper) {
    if (byte === 0) {
      prefix.push(0);
      continue;
    }

    // A prefix that ends in zero leaves no room below it except inside the bytes that follow it
    // in the key, which are mostly zero. One more byte keeps 255 steps of room.
    if (byte === 1) {
      prefix.push(0, 0xff);
      return prefix;
    }

    prefix.push(byte - 1);
    return prefix;
  }

  return prefix;
}

/** The common start of two keys, then the midpoint of the first bytes that leave room. */
function prefixBetween(lower: Uint8Array, upper: Uint8Array): number[] {
  const prefix: number[] = [];
  // Whether `prefix` still equals the start of `upper`.
  let bounded = true;

  for (let index = 0; ; index++) {
    const low = index < lower.length ? lower[index] : 0;
    const high = bounded && index < upper.length ? upper[index] : 256;

    if (high > low + 1) {
      prefix.push(Math.floor((low + high) / 2));
      break;
    }

    prefix.push(low);
    if (low < high) bounded = false;
  }

  return prefix;
}

/**
 * A key that sorts strictly between `lower` and `upper`; `null` leaves that side open.
 * The key ends with the writer's client id (8 bytes), its clock (4 bytes) and a final 1.
 */
export function keyBetween(lower: Uint8Array | null, upper: Uint8Array | null, writer: KeyWriter): Uint8Array {
  let prefix: number[];

  if (lower && upper) {
    prefix = prefixBetween(lower, upper);
  } else if (lower) {
    prefix = prefixAbove(lower);
  } else if (upper) {
    prefix = prefixBelow(upper);
  } else {
    prefix = [0x80];
  }

  return finishKey(prefix, writer);
}

/** A key from its ordering prefix: the prefix, the writer's client id and clock, and a final 1. */
function finishKey(prefix: number[], writer: KeyWriter): Uint8Array {
  const key = new Uint8Array(prefix.length + 13);
  const view = new DataView(key.buffer);

  key.set(prefix, 0);
  view.setBigUint64(prefix.length, BigInt.asUintN(64, writer.client));
  view.setUint32(prefix.length + 8, writer.clock >>> 0);
  key[prefix.length + 12] = KEY_END;
  return key;
}

interface Arrangement<T extends RowLike> {
  order: T[];
  index: Map<string, number>;
  placements: RowPlacements;
}

function arrange<T extends RowLike>(canonical: T[], placements: RowPlacements): Arrangement<T> {
  const index = new Map<string, number>();

  if (placements.size === 0) return { order: canonical.slice(), index, placements };

  canonical.forEach((row, position) => index.set(row.id, position));

  // Every placed row with its slot: zero for the start slot, otherwise one more than the
  // canonical index of its anchor.
  const placed = new Array<boolean>(canonical.length).fill(false);
  const entries: Array<{ slot: number; key: Uint8Array; rowId: string; rowIndex: number }> = [];

  placements.forEach((placement, rowId) => {
    const rowIndex = index.get(rowId);

    if (rowIndex === undefined) return;

    let slot = 0;

    if (placement.anchor !== null) {
      const anchorIndex = index.get(placement.anchor);

      if (anchorIndex === undefined) return;
      slot = anchorIndex + 1;
    }

    placed[rowIndex] = true;
    entries.push({ slot, key: placement.key, rowId, rowIndex });
  });

  // Rows of one slot are ordered by key, then by id, the same way on every device.
  entries.sort(
    (left, right) => left.slot - right.slot || compareBytes(left.key, right.key) || compareIds(left.rowId, right.rowId)
  );

  const order: T[] = [];
  let next = 0;
  const pushSlot = (slot: number) => {
    while (next < entries.length && entries[next].slot === slot) {
      order.push(canonical[entries[next].rowIndex]);
      next++;
    }
  };

  pushSlot(0);
  canonical.forEach((row, position) => {
    if (!placed[position]) order.push(row);
    pushSlot(position + 1);
  });

  return { order, index, placements };
}

/** The placement of a row, when it counts: the row and its anchor are canonical rows. */
function validPlacement<T extends RowLike>(arrangement: Arrangement<T>, rowId: string): RowPlacement | undefined {
  const placement = arrangement.placements.get(rowId);

  if (!placement || !arrangement.index.has(rowId)) return undefined;
  if (placement.anchor !== null && !arrangement.index.has(placement.anchor)) return undefined;
  return placement;
}

/**
 * The order of an anchored view. `canonical` must hold every row of the Database once, in the
 * storage view's order.
 */
export function anchoredOrder<T extends RowLike>(canonical: T[], placements: RowPlacements): T[] {
  return arrange(canonical, placements).order;
}

/** The placement that puts a row between two neighbours in the view's order. */
function placementBetween<T extends RowLike>(
  arrangement: Arrangement<T>,
  previous: string | undefined,
  next: string | undefined,
  writer: KeyWriter
): RowPlacement {
  // The row joins the slot its predecessor is in, right after it. An unplaced predecessor sits
  // at its canonical place, so the row becomes the first of that predecessor's own slot.
  let anchor: string | null = null;
  let lower: Uint8Array | null = null;

  if (previous !== undefined) {
    const placement = validPlacement(arrangement, previous);

    if (placement) {
      anchor = placement.anchor;
      lower = placement.key;
    } else {
      anchor = previous;
    }
  }

  const nextPlacement = next === undefined ? undefined : validPlacement(arrangement, next);
  const upper = nextPlacement && nextPlacement.anchor === anchor ? nextPlacement.key : null;

  return { anchor, key: keyBetween(lower, upper, writer) };
}

function placementIn<T extends RowLike>(
  arrangement: Arrangement<T>,
  rowId: string,
  target: RowTarget,
  writer: KeyWriter
): RowPlacement | null {
  const order = arrangement.order;
  const current = order.findIndex((row) => row.id === rowId);

  if (current === -1) return null;

  // The index among the other rows that the row should take.
  const amongOthers = (id: string) => {
    const position = order.findIndex((row) => row.id === id);

    if (position === -1) return undefined;
    return position > current ? position - 1 : position;
  };

  let wanted: number | undefined;

  switch (target.at) {
    case 'start':
      wanted = 0;
      break;
    case 'end':
      wanted = order.length - 1;
      break;
    case 'before':
      wanted = target.row === rowId ? undefined : amongOthers(target.row);
      break;
    case 'after': {
      const position = target.row === rowId ? undefined : amongOthers(target.row);

      wanted = position === undefined ? undefined : position + 1;
      break;
    }
  }

  if (wanted === undefined || wanted === current) return null;

  // The other rows keep their order; `index` counts among them.
  const other = (index: number) => order[index >= current ? index + 1 : index]?.id;
  const previous = wanted > 0 ? other(wanted - 1) : undefined;

  return placementBetween(arrangement, previous, other(wanted), writer);
}

/**
 * The placement that puts `rowId` at `target` in an anchored view, or `null` when the row is
 * already there or a row is missing.
 */
export function placementAt<T extends RowLike>(
  canonical: T[],
  placements: RowPlacements,
  rowId: string,
  target: RowTarget,
  writer: KeyWriter
): RowPlacement | null {
  return placementIn(arrange(canonical, placements), rowId, target, writer);
}

/**
 * The placement for dragging `fromId` to the place of `toId`: a row moved towards the end lands
 * right after `toId`, a row moved towards the start right before it, as a move in an array does.
 * `null` when nothing has to change or a row is missing.
 */
export function placementForMove<T extends RowLike>(
  canonical: T[],
  placements: RowPlacements,
  fromId: string,
  toId: string,
  writer: KeyWriter
): RowPlacement | null {
  const arrangement = arrange(canonical, placements);
  const from = arrangement.order.findIndex((row) => row.id === fromId);
  const to = arrangement.order.findIndex((row) => row.id === toId);

  if (from === -1 || to === -1 || from === to) return null;

  return placementIn(arrangement, fromId, from < to ? { at: 'after', row: toId } : { at: 'before', row: toId }, writer);
}

/**
 * What to change in a view's placements when `removed` rows leave the Database, so that every
 * other row stays where it is. Rows anchored at a removed row move to the slot of the nearest
 * canonical row before it that stays, after the rows already there, in the order they had.
 */
export function repairAfterRemoval<T extends RowLike>(
  canonical: T[],
  placements: RowPlacements,
  removed: Set<string>,
  writer: KeyWriter
): PlacementRepair {
  const index = new Map<string, number>();

  canonical.forEach((row, position) => index.set(row.id, position));

  const remove = Array.from(placements.keys()).filter((rowId) => removed.has(rowId));
  // The rows that stay, by the canonical index of their anchor; -1 is the start slot.
  const slots = new Map<number, Array<{ key: Uint8Array; rowId: string }>>();

  placements.forEach((placement, rowId) => {
    if (removed.has(rowId) || !index.has(rowId)) return;

    const anchorIndex = placement.anchor === null ? -1 : index.get(placement.anchor);

    if (anchorIndex === undefined) return;

    const slot = slots.get(anchorIndex) ?? [];

    slot.push({ key: placement.key, rowId });
    slots.set(anchorIndex, slot);
  });
  slots.forEach((slot) =>
    slot.sort((left, right) => compareBytes(left.key, right.key) || compareIds(left.rowId, right.rowId))
  );

  const write: Array<[string, RowPlacement]> = [];
  // The last key of each slot that received rows, as it grows.
  const lastKeys = new Map<number, Uint8Array>();
  let target = -1;
  let clock = writer.clock;

  canonical.forEach((row, position) => {
    if (!removed.has(row.id)) {
      target = position;
      return;
    }

    const orphans = slots.get(position);

    if (!orphans) return;

    orphans.forEach(({ rowId }) => {
      const existing = slots.get(target);
      const lower = lastKeys.get(target) ?? (existing?.length ? existing[existing.length - 1].key : null);
      const key = keyBetween(lower, null, { client: writer.client, clock });

      clock = (clock + 1) >>> 0;
      lastKeys.set(target, key);
      write.push([rowId, { anchor: target === -1 ? null : canonical[target].id, key }]);
    });
  });

  return { remove, write };
}

/** For each element of a sequence of distinct numbers: whether it is on one longest increasing subsequence. */
function onLongestIncreasingSubsequence(sequence: number[]): boolean[] {
  // `tails[length - 1]` is the index of the smallest value that ends an increasing run of `length`.
  const tails: number[] = [];
  const previous: Array<number | undefined> = new Array(sequence.length).fill(undefined);

  sequence.forEach((value, index) => {
    let low = 0;
    let high = tails.length;

    while (low < high) {
      const middle = (low + high) >>> 1;

      if (sequence[tails[middle]] < value) low = middle + 1;
      else high = middle;
    }

    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });

  const keep: boolean[] = new Array(sequence.length).fill(false);
  let cursor = tails.length > 0 ? tails[tails.length - 1] : undefined;

  while (cursor !== undefined) {
    keep[cursor] = true;
    cursor = previous[cursor];
  }

  return keep;
}

/**
 * The placements that make an anchored view show `target`, or `null` when `target` does not hold
 * exactly the canonical rows, each once.
 *
 * The rows on a longest increasing subsequence of canonical positions need no placement. Every
 * other row is placed after the last unplaced row before it, with keys spread evenly so that a
 * long run of placed rows does not produce long keys.
 */
export function placementsForOrder<T extends RowLike>(
  canonical: T[],
  target: string[],
  writer: KeyWriter
): Array<[string, RowPlacement]> | null {
  const index = new Map<string, number>();

  canonical.forEach((row, position) => index.set(row.id, position));
  if (
    index.size !== canonical.length ||
    target.length !== canonical.length ||
    new Set(target).size !== target.length ||
    target.some((rowId) => !index.has(rowId))
  ) {
    return null;
  }

  const keep = onLongestIncreasingSubsequence(target.map((rowId) => index.get(rowId) as number));
  const runs: Array<{ anchor: string | null; rows: string[] }> = [{ anchor: null, rows: [] }];

  target.forEach((rowId, position) => {
    if (keep[position]) runs.push({ anchor: rowId, rows: [] });
    else runs[runs.length - 1].rows.push(rowId);
  });

  const placements: Array<[string, RowPlacement]> = [];

  runs.forEach(({ anchor, rows }) => {
    rows.forEach((rowId, position) => {
      // The fraction (position + 1) / (rows + 1) of the 32-bit range, as four bytes.
      const spread = Number((BigInt(position + 1) << 32n) / BigInt(rows.length + 1));
      const prefix = [(spread >>> 24) & 0xff, (spread >>> 16) & 0xff, (spread >>> 8) & 0xff, spread & 0xff];

      placements.push([rowId, { anchor, key: finishKey(prefix, writer) }]);
    });
  });

  return placements;
}
