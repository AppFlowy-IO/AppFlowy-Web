import * as decoding from 'lib0/decoding';

import { YDoc } from '@/application/types';

/**
 * What the server has proven it holds of one open Y.Doc, learned from its own messages.
 *
 * A manifest reply, `Y.encodeStateAsUpdate(doc, requestStateVector)`, can be a no-op for the
 * server even though its bytes are not empty:
 * - Yjs (`encodeStateAsUpdate`, `diffUpdate`) and yrs (`encode_diff_v1`) write the complete delete
 *   set into every diff, because deletions carry no clock a state vector could cover. A page with
 *   any deletion in its history therefore never yields the empty update.
 * - The request can come from a sibling tab whose state vector is behind the server, so the reply
 *   also repeats structs the server holds.
 * Neither is a local change. On the outbox path a reader would see "waiting for edit access" and
 * an editor would upload the same bytes again.
 *
 * Only the server's own Updates prove anything: those that carry a stream message id, whether
 * they arrive over this tab's socket, are relayed by the tab that owns the socket, or are built
 * from an HTTP sync result that carries the server's message id. Their structs are in the
 * server's stream, and the Update that answers a state-vector request carries the server's
 * complete delete set. The fan-out of local edits between tabs has no message id and proves
 * nothing, so a deletion still on its way to the server is never treated as held. A local change
 * is covered only once the server itself has sent it back (for example a concurrent identical
 * deletion).
 *
 * The record lasts one exchange: it restarts each time this context sends its state-vector
 * request (bind and reconnect), so a server that lost data since an earlier exchange gets it
 * again in the next reply. Within one exchange it relies on the server keeping what it sent. It
 * is also ignored once the collab version or the database restore generation changes.
 *
 * The server's opt-in delete-set digest (`SyncRequest.delete_set`, used by the desktop client) is
 * not used: the Web protocol does not carry that field, and a digest covers deletions only.
 */

/** Sorted, disjoint, non-adjacent half-open clock ranges, flattened: [start0, end0, start1, end1, ...]. */
type Ranges = number[];
type ClientRanges = Map<number, Ranges>;

interface ServerRecord {
  version: string | undefined;
  databaseRestoreId: string | undefined;
  structs: ClientRanges;
  deletes: ClientRanges;
}

const records = new WeakMap<YDoc, ServerRecord>();

/** The first range, from index `from` on, that ends at or after `clock`. Ends ascend like starts. */
function firstEndingAtOrAfter(ranges: Ranges, clock: number, from: number): number {
  const count = ranges.length >> 1;
  let low = from;

  if (low >= count || ranges[low * 2 + 1] >= clock) return low;
  // Gallop forward from `from`, then search the last stride. Sorted lookups stay close to the cursor.
  let step = 1;

  low += 1;
  while (low + step <= count && ranges[(low + step - 1) * 2 + 1] < clock) {
    low += step;
    step *= 2;
  }

  let high = Math.min(low + step, count);

  while (low < high) {
    const middle = (low + high) >> 1;

    if (ranges[middle * 2 + 1] < clock) low = middle + 1;
    else high = middle;
  }

  return low;
}

/** The first range, from index `from` on, that starts after `clock`. */
function firstStartingAfter(ranges: Ranges, clock: number, from: number): number {
  let low = from;
  let high = ranges.length >> 1;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (ranges[middle * 2] <= clock) low = middle + 1;
    else high = middle;
  }

  return low;
}

/** Adds [start, end), merging overlapping and adjacent ranges in place. Returns true when `ranges` grew. */
function insertRange(ranges: Ranges, start: number, end: number): boolean {
  if (end <= start) return false;
  const first = firstEndingAtOrAfter(ranges, start, 0);
  const after = firstStartingAfter(ranges, end, first);

  if (first === after) {
    ranges.splice(first * 2, 0, start, end);
    return true;
  }

  const mergedStart = Math.min(start, ranges[first * 2]);
  const mergedEnd = Math.max(end, ranges[(after - 1) * 2 + 1]);

  if (after - first === 1 && mergedStart === ranges[first * 2] && mergedEnd === ranges[first * 2 + 1]) return false;
  ranges.splice(first * 2, (after - first) * 2, mergedStart, mergedEnd);
  return true;
}

/** Merges two sorted range lists in one pass. */
function mergeRanges(left: Ranges, right: Ranges): Ranges {
  const merged: Ranges = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length || rightIndex < right.length) {
    const takeLeft = rightIndex >= right.length || (leftIndex < left.length && left[leftIndex] <= right[rightIndex]);
    const source = takeLeft ? left : right;
    const index = takeLeft ? leftIndex : rightIndex;
    const start = source[index];
    const end = source[index + 1];

    if (takeLeft) leftIndex += 2;
    else rightIndex += 2;
    const last = merged.length - 1;

    if (last > 0 && start <= merged[last]) merged[last] = Math.max(merged[last], end);
    else merged.push(start, end);
  }

  return merged;
}

/**
 * Answers "is [start, end) inside one range?" for one client's ranges. Lookups made in clock
 * order (as an update lists them) resume from the previous position.
 */
class Coverage {
  private readonly ranges: Ranges | undefined;

  private index = 0;

  private lastEnd = -1;

  constructor(ranges: Ranges | undefined) {
    this.ranges = ranges;
  }

  covers(start: number, end: number): boolean {
    if (!this.ranges) return false;
    // Ranges never touch, so a covered range lies inside the first range that reaches its end.
    this.index = firstEndingAtOrAfter(this.ranges, end, end >= this.lastEnd ? this.index : 0);
    this.lastEnd = end;
    return this.index * 2 < this.ranges.length && this.ranges[this.index * 2] <= start;
  }
}

function coverageOf(ranges: ClientRanges, cache: Map<number, Coverage>, client: number): Coverage {
  let coverage = cache.get(client);

  if (!coverage) {
    coverage = new Coverage(ranges.get(client));
    cache.set(client, coverage);
  }

  return coverage;
}

/** Adds `incoming` (sorted and merged) to `client`'s ranges. Returns true when they grew. */
function addClientRanges(target: ClientRanges, client: number, incoming: Ranges): boolean {
  const existing = target.get(client);

  if (!existing || existing.length === 0) {
    target.set(client, incoming);
    return true;
  }

  const coverage = new Coverage(existing);
  let known = true;

  // Answers to other tabs' requests repeat the server's complete delete set: usually nothing is new.
  for (let index = 0; index < incoming.length && known; index += 2) {
    known = coverage.covers(incoming[index], incoming[index + 1]);
  }

  if (known) return false;
  if (incoming.length <= 16) {
    for (let index = 0; index < incoming.length; index += 2) insertRange(existing, incoming[index], incoming[index + 1]);
  } else {
    target.set(client, mergeRanges(existing, incoming));
  }

  return true;
}

// lib0 v1 update encoding, as read by Yjs (`LazyStructReader`, `readItemContent`, `readDeleteSet`).
const BITS5 = 0b11111;
const PARENT_SUB = 0x20;
const RIGHT_ORIGIN = 0x40;
const ORIGIN = 0x80;
const SKIP = 10;
const XML_ELEMENT = 3;
const XML_HOOK = 5;
const LAST_TYPE_REF = 6;

interface UpdateVisitor {
  /** A run of structs starts at `clock`. Returning false stops the walk. */
  runStart?: (client: number, clock: number) => boolean;
  /** A run of structs [start, end) with no Skip inside. Returning false stops the walk. */
  structs: (client: number, start: number, end: number) => boolean;
  /** A deleted range [start, end). Returning false stops the walk. */
  deletes: (client: number, start: number, end: number) => boolean;
}

/** Length-prefixed strings and byte arrays share one layout. */
function skipBytes(decoder: decoding.Decoder): void {
  decoding.readVarUint8Array(decoder);
}

function skipId(decoder: decoding.Decoder): void {
  decoding.readVarUint(decoder);
  decoding.readVarUint(decoder);
}

/** Reads one Item after its info byte and returns its clock length. */
function readItemLength(decoder: decoding.Decoder, info: number): number {
  if ((info & ORIGIN) !== 0) skipId(decoder);
  if ((info & RIGHT_ORIGIN) !== 0) skipId(decoder);
  if ((info & (ORIGIN | RIGHT_ORIGIN)) === 0) {
    // Parent: a root type name or the id of the parent item.
    if (decoding.readVarUint(decoder) === 1) skipBytes(decoder);
    else skipId(decoder);
    if ((info & PARENT_SUB) !== 0) skipBytes(decoder);
  }

  switch (info & BITS5) {
    case 1: // ContentDeleted
      return decoding.readVarUint(decoder);
    case 2: { // ContentJSON
      const length = decoding.readVarUint(decoder);

      for (let index = 0; index < length; index += 1) skipBytes(decoder);
      return length;
    }

    case 3: // ContentBinary
    case 5: // ContentEmbed
      skipBytes(decoder);
      return 1;
    case 4: // ContentString: its clock length is the string's length in UTF-16 code units.
      return decoding.readVarString(decoder).length;
    case 6: // ContentFormat: key and value
      skipBytes(decoder);
      skipBytes(decoder);
      return 1;
    case 7: { // ContentType
      const typeRef = decoding.readVarUint(decoder);

      if (typeRef > LAST_TYPE_REF) throw new Error(`Unknown Yjs type ${typeRef}`);
      if (typeRef === XML_ELEMENT || typeRef === XML_HOOK) skipBytes(decoder);
      return 1;
    }

    case 8: { // ContentAny
      const length = decoding.readVarUint(decoder);

      for (let index = 0; index < length; index += 1) decoding.readAny(decoder);
      return length;
    }

    case 9: // ContentDoc: guid and options
      skipBytes(decoder);
      decoding.readAny(decoder);
      return 1;
    case 11: { // ContentMove
      const flags = decoding.readVarUint(decoder);

      skipId(decoder);
      if ((flags & 1) === 0) skipId(decoder);
      return 1;
    }

    default:
      throw new Error(`Unknown Yjs content ${info & BITS5}`);
  }
}

/**
 * Walks a lib0 v1 update without building structs. Returns true when it was read to its end,
 * false when the visitor stopped, and null when the bytes are not a complete v1 update.
 */
function walkUpdate(update: Uint8Array, visitor: UpdateVisitor): boolean | null {
  try {
    const decoder = decoding.createDecoder(update);

    for (let groups = decoding.readVarUint(decoder); groups > 0; groups -= 1) {
      const structs = decoding.readVarUint(decoder);
      const client = decoding.readVarUint(decoder);
      let clock = decoding.readVarUint(decoder);
      let runStart = -1;

      for (let index = 0; index < structs; index += 1) {
        const info = decoding.readUint8(decoder);

        if (info === SKIP) {
          if (runStart !== -1 && !visitor.structs(client, runStart, clock)) return false;
          runStart = -1;
          clock += decoding.readVarUint(decoder);
          continue;
        }

        if (runStart === -1) {
          if (visitor.runStart && !visitor.runStart(client, clock)) return false;
          runStart = clock;
        }

        // GC structs carry only their length.
        clock += (info & BITS5) === 0 ? decoding.readVarUint(decoder) : readItemLength(decoder, info);
      }

      if (runStart !== -1 && !visitor.structs(client, runStart, clock)) return false;
    }

    for (let clients = decoding.readVarUint(decoder); clients > 0; clients -= 1) {
      const client = decoding.readVarUint(decoder);

      for (let deletes = decoding.readVarUint(decoder); deletes > 0; deletes -= 1) {
        const clock = decoding.readVarUint(decoder);
        const length = decoding.readVarUint(decoder);

        if (length > 0 && !visitor.deletes(client, clock, clock + length)) return false;
      }
    }

    return decoding.hasContent(decoder) ? null : true;
  } catch {
    return null;
  }
}

/**
 * The struct ranges (gaps marked by Skip structs excluded) and deleted ranges of a lib0 v1 update,
 * per client, or null when it cannot be read.
 */
export function readUpdateRanges(update: Uint8Array): { structs: ClientRanges; deletes: ClientRanges } | null {
  const structs: ClientRanges = new Map();
  const deletes: ClientRanges = new Map();
  const add = (target: ClientRanges) => (client: number, start: number, end: number) => {
    let ranges = target.get(client);

    if (!ranges) {
      ranges = [];
      target.set(client, ranges);
    }

    insertRange(ranges, start, end);
    return true;
  };

  return walkUpdate(update, { structs: add(structs), deletes: add(deletes) }) ? { structs, deletes } : null;
}

function currentRecord(doc: YDoc): ServerRecord | undefined {
  const record = records.get(doc);

  if (!record || record.version !== doc.version || record.databaseRestoreId !== doc.databaseRestoreId) return undefined;
  return record;
}

function newRecord(doc: YDoc): ServerRecord {
  const record: ServerRecord = {
    version: doc.version,
    databaseRestoreId: doc.databaseRestoreId,
    structs: new Map(),
    deletes: new Map(),
  };

  records.set(doc, record);
  return record;
}

/** This context is sending its state-vector request: forget what the server proved before. */
export function beginServerExchange(doc: YDoc): void {
  newRecord(doc);
}

/**
 * Records what a server Update (one that carries a stream message id) proves the server holds.
 * `update` is its lib0 v1 payload, or null when it is not v1 (lib0 v2): such an Update proves
 * nothing, and neither do unreadable bytes. Returns true when the record grew.
 */
export function recordServerUpdate(doc: YDoc, update: Uint8Array | null): boolean {
  const ranges = update ? readUpdateRanges(update) : null;

  if (!ranges) return false;
  const record = currentRecord(doc) ?? newRecord(doc);
  let grew = false;

  for (const [client, incoming] of ranges.structs) grew = addClientRanges(record.structs, client, incoming) || grew;
  for (const [client, incoming] of ranges.deletes) grew = addClientRanges(record.deletes, client, incoming) || grew;
  return grew;
}

/**
 * True only when applying the lib0 v1 `update` to the server would change nothing: every struct
 * and every deletion in it is one the server has proven it holds since this context's last
 * request. An unsent local change, or unreadable bytes, make it a change.
 */
export function isNoopForServer(doc: YDoc, update: Uint8Array): boolean {
  const record = currentRecord(doc);

  if (!record) return false;
  const structs = new Map<number, Coverage>();
  const deletes = new Map<number, Coverage>();

  return walkUpdate(update, {
    // Stop at the first struct the server has not proven, before reading the rest of the run.
    runStart: (client, clock) => coverageOf(record.structs, structs, client).covers(clock, clock + 1),
    structs: (client, start, end) => coverageOf(record.structs, structs, client).covers(start, end),
    deletes: (client, start, end) => coverageOf(record.deletes, deletes, client).covers(start, end),
  }) === true;
}
