import * as Y from 'yjs';

import { canonicalizeUserUid, UserUid } from '@/application/user-uid';
import { CollabOrigin, YDoc, YjsEditorKey } from '@/application/types';

/**
 * Row-level reactions live on the row document's meta map under this plain
 * key (see `ROW_REACTIONS` in `libs/collab/src/database/rows/row.rs`). The
 * value is a JSON object of `emoji -> [i64 user id, ...]`.
 */
export const ROW_REACTIONS_META_KEY = 'row_reactions';

/** Emoji -> canonical decimal user ids, in insertion order. */
export type RowReactions = Record<string, string[]>;

const ARRAY_INTEGER_PATTERN = /([[,]\s*)(-?\d+)(?=\s*[,\]])/g;

/**
 * Parse Desktop's `HashMap<String, Vec<i64>>` JSON without losing precision.
 * User ids exceed `Number.MAX_SAFE_INTEGER`, so bare integers inside arrays
 * are quoted before parsing and then canonicalized as decimal strings.
 */
export function parseRowReactions(raw: unknown): RowReactions {
  if (typeof raw !== 'string' || raw.trim().length === 0) return {};

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw.replace(ARRAY_INTEGER_PATTERN, '$1"$2"'));
  } catch (error) {
    console.warn('[RowReaction] Failed to parse row reactions:', error);
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const reactions: RowReactions = {};

  Object.entries(parsed as Record<string, unknown>).forEach(([emoji, users]) => {
    if (!Array.isArray(users)) return;

    const uids: string[] = [];

    users.forEach((user) => {
      const uid = canonicalizeUserUid(user as UserUid);

      if (uid !== null && !uids.includes(uid)) uids.push(uid);
    });

    if (uids.length > 0) reactions[emoji] = uids;
  });

  return reactions;
}

/**
 * Serialize reactions in the exact shape Desktop deserializes: emoji keys and
 * unquoted integer user ids. Non-numeric ids are dropped because they would
 * make the whole map unreadable on Desktop.
 */
export function serializeRowReactions(reactions: RowReactions): string {
  const entries = Object.entries(reactions)
    .map(([emoji, uids]) => {
      const numericUids = uids.map((uid) => canonicalizeUserUid(uid)).filter((uid): uid is string => uid !== null);

      return numericUids.length > 0 ? `${JSON.stringify(emoji)}:[${numericUids.join(',')}]` : null;
    })
    .filter((entry): entry is string => entry !== null);

  return `{${entries.join(',')}}`;
}

export function getRowMetaMap(rowDoc: YDoc): Y.Map<unknown> | undefined {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);

  return rowSharedRoot.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
}

export function readRowReactions(rowDoc: YDoc): RowReactions {
  return parseRowReactions(getRowMetaMap(rowDoc)?.get(ROW_REACTIONS_META_KEY));
}

function ensureRowMetaMap(rowDoc: YDoc): Y.Map<unknown> {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
  let meta = rowSharedRoot.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;

  if (!meta) {
    meta = new Y.Map<unknown>();
    rowDoc.transact(() => {
      rowSharedRoot.set(YjsEditorKey.meta, meta);
    }, CollabOrigin.Local);
  }

  return meta;
}

function writeRowReactions(rowDoc: YDoc, reactions: RowReactions): void {
  const meta = ensureRowMetaMap(rowDoc);

  rowDoc.transact(() => {
    meta.set(ROW_REACTIONS_META_KEY, serializeRowReactions(reactions));
  }, CollabOrigin.Local);
}

export function addRowReaction(rowDoc: YDoc, emoji: string, uid: UserUid): boolean {
  const canonicalUid = canonicalizeUserUid(uid);

  if (!emoji || canonicalUid === null) return false;

  const reactions = readRowReactions(rowDoc);
  const users = reactions[emoji] ?? [];

  if (users.includes(canonicalUid)) return false;

  reactions[emoji] = [...users, canonicalUid];
  writeRowReactions(rowDoc, reactions);
  return true;
}

export function removeRowReaction(rowDoc: YDoc, emoji: string, uid: UserUid): boolean {
  const canonicalUid = canonicalizeUserUid(uid);

  if (!emoji || canonicalUid === null) return false;

  const reactions = readRowReactions(rowDoc);
  const users = reactions[emoji];

  if (!users?.includes(canonicalUid)) return false;

  const remaining = users.filter((user) => user !== canonicalUid);

  if (remaining.length > 0) {
    reactions[emoji] = remaining;
  } else {
    delete reactions[emoji];
  }

  writeRowReactions(rowDoc, reactions);
  return true;
}

/** Add the reaction when the user has not reacted yet, otherwise remove it. */
export function toggleRowReaction(rowDoc: YDoc, emoji: string, uid: UserUid): void {
  const canonicalUid = canonicalizeUserUid(uid);

  if (!emoji || canonicalUid === null) return;

  if (readRowReactions(rowDoc)[emoji]?.includes(canonicalUid)) {
    removeRowReaction(rowDoc, emoji, canonicalUid);
  } else {
    addRowReaction(rowDoc, emoji, canonicalUid);
  }
}
