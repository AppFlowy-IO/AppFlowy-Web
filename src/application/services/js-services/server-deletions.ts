import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

import { YDoc } from '@/application/types';

/**
 * Deletions the server has proven it holds, per open Y.Doc.
 *
 * Yjs deletions carry no clock, so no state vector can show that a deletion
 * reached the server. Yjs (`encodeStateAsUpdate`, `diffUpdate`) and yrs
 * (`encode_diff_v1`) therefore write the complete delete set into every diff,
 * whatever the target state vector. A manifest reply for a page with any
 * deletion in its history is never empty, even when the server already has
 * everything, and it must not be mistaken for a local change.
 *
 * The only proof is the server's own bytes. The server answers a state-vector
 * request with an Update holding the diff (and so its complete delete set)
 * before it sends its own state vector, and every server Update carries a
 * stream message id. Updates fanned out by sibling tabs carry none and are not
 * recorded: their deletions may still be on their way to the server.
 *
 * Yjs never undeletes, so within one collab version and database restore
 * generation the server's delete set only grows. The record is dropped when
 * either changes; a version reset or a restore also replaces the Y.Doc.
 */

/** Half-open clock range `[clock, clock + len)` of one client. */
interface DeleteRange {
  clock: number;
  len: number;
}

/** Ranges per client, sorted by clock with overlapping and adjacent ranges merged. */
type DeleteSet = Map<number, DeleteRange[]>;

interface ServerDeletions {
  version: string | undefined;
  databaseRestoreId: string | undefined;
  deletes: DeleteSet;
}

const serverDeletions = new WeakMap<Y.Doc, ServerDeletions>();

function normalize(ranges: DeleteRange[]): DeleteRange[] {
  const sorted = ranges.filter((range) => range.len > 0).sort((left, right) => left.clock - right.clock);
  const merged: DeleteRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    if (last && range.clock <= last.clock + last.len) {
      last.len = Math.max(last.len, range.clock + range.len - last.clock);
    } else {
      merged.push({ clock: range.clock, len: range.len });
    }
  }

  return merged;
}

/**
 * Reads a lib0 v1 update that holds no structs. Returns null when it holds
 * any struct or cannot be read, so callers never treat it as a no-op.
 */
function readStructlessUpdate(update: Uint8Array): DeleteSet | null {
  try {
    const decoder = decoding.createDecoder(update);

    if (decoding.readVarUint(decoder) !== 0) return null;
    const deletes: DeleteSet = new Map();
    const clients = decoding.readVarUint(decoder);

    for (let index = 0; index < clients; index += 1) {
      const client = decoding.readVarUint(decoder);
      const count = decoding.readVarUint(decoder);
      const ranges = deletes.get(client) ?? [];

      for (let item = 0; item < count; item += 1) {
        ranges.push({ clock: decoding.readVarUint(decoder), len: decoding.readVarUint(decoder) });
      }

      deletes.set(client, ranges);
    }

    if (decoding.hasContent(decoder)) return null;
    deletes.forEach((ranges, client) => deletes.set(client, normalize(ranges)));
    return deletes;
  } catch {
    return null;
  }
}

/** The delete set of any lib0 v1 update: drop every struct, keep its deletions. */
function deleteSetOf(update: Uint8Array): DeleteSet | null {
  const structless = readStructlessUpdate(update);

  if (structless) return structless;

  try {
    const ownStructs = Y.encodeStateVector(Y.parseUpdateMeta(update).to);

    return readStructlessUpdate(Y.diffUpdate(update, ownStructs));
  } catch {
    return null;
  }
}

function covers(acknowledged: DeleteRange[], range: DeleteRange): boolean {
  let low = 0;
  let high = acknowledged.length - 1;

  // The last acknowledged range starting at or before `range`. Merged ranges
  // never touch, so a covered range lies inside exactly that one.
  while (low <= high) {
    const middle = (low + high) >> 1;

    if (acknowledged[middle].clock <= range.clock) low = middle + 1;
    else high = middle - 1;
  }

  const candidate = acknowledged[high];

  return Boolean(candidate) && candidate.clock + candidate.len >= range.clock + range.len;
}

function currentRecord(doc: YDoc): ServerDeletions | undefined {
  const record = serverDeletions.get(doc);

  if (!record || record.version !== doc.version || record.databaseRestoreId !== doc.databaseRestoreId) return undefined;
  return record;
}

/**
 * Records the deletions in a lib0 v1 update received from the server for this
 * doc. Call it only for server Updates (those with a message id). Unreadable
 * bytes record nothing.
 */
export function recordServerDeletions(doc: YDoc, update: Uint8Array): void {
  const deletes = deleteSetOf(update);

  if (!deletes || deletes.size === 0) return;
  let record = currentRecord(doc);

  if (!record) {
    record = { version: doc.version, databaseRestoreId: doc.databaseRestoreId, deletes: new Map() };
    serverDeletions.set(doc, record);
  }

  for (const [client, ranges] of deletes) {
    record.deletes.set(client, normalize([...(record.deletes.get(client) ?? []), ...ranges]));
  }
}

/**
 * True only when applying the lib0 v1 `update` to the server would change
 * nothing: it holds no struct, and every deletion in it is one the server has
 * already sent for this doc. A local deletion the server has not echoed back,
 * or any struct, makes it a real change.
 */
export function isNoopForServer(doc: YDoc, update: Uint8Array): boolean {
  const deletes = readStructlessUpdate(update);

  if (!deletes) return false;
  const acknowledged = currentRecord(doc)?.deletes;

  for (const [client, ranges] of deletes) {
    const known = acknowledged?.get(client) ?? [];

    if (!ranges.every((range) => covers(known, range))) return false;
  }

  return true;
}
