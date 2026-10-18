import { v4 as uuidv4 } from 'uuid';

import { Log } from '@/utils/log';

/**
 * Discarding paused edits deletes them from the outbox, but any tab that still
 * holds the page in memory could rebuild them (a manifest reply after a socket
 * reconnect, a full sync) and upload them once edit access returns. Each
 * discard is therefore recorded in localStorage, which also announces it to
 * the other tabs. A tab that was already open when the discard happened may
 * not upload that object again until it has either reloaded (the record then
 * predates the tab) or confirmed it holds no copy (`settleDiscardedEdits`).
 */

export interface DiscardScope {
  serverUrl?: string;
  userId: string;
  workspaceId: string;
}

type DiscardEntry = { id: string; at: number };
type DiscardRecord = Record<string, DiscardEntry>;
type DiscardListener = (objectIds: string[]) => void;

const KEY_PREFIX = 'af_discarded_edits:v1:';
// Older records are dropped; only a tab left open, without reloading, for this
// long after a discard would no longer be fenced by it.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const listeners = new Map<string, Set<DiscardListener>>();
// Discards recorded before this tab loaded cannot be held in its memory.
const recordedBeforeLoad = new Set<string>();
// Discards this tab confirmed it holds no copy of.
const settled = new Set<string>();

function storageKey(scope: DiscardScope): string {
  return `${KEY_PREFIX}${JSON.stringify([scope.serverUrl ?? '', scope.userId, scope.workspaceId])}`;
}

function isEntry(value: unknown): value is DiscardEntry {
  const entry = value as Partial<DiscardEntry> | null;

  return Boolean(entry) && typeof entry?.id === 'string' && typeof entry.at === 'number';
}

function readRecord(key: string): DiscardRecord {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => isEntry(entry))) as DiscardRecord;
  } catch {
    return {};
  }
}

function isUnsettled(entry: DiscardEntry | undefined): boolean {
  return Boolean(entry) && !recordedBeforeLoad.has(entry!.id) && !settled.has(entry!.id);
}

try {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);

    if (key?.startsWith(KEY_PREFIX)) Object.values(readRecord(key)).forEach((entry) => recordedBeforeLoad.add(entry.id));
  }
} catch {
  // No storage, so no discard can have been recorded.
}

/**
 * Records discarded objects; other tabs receive the write as a storage event.
 * Throws when it cannot be stored: the edits must then not be discarded, since
 * another tab could rebuild and upload them.
 */
export function recordDiscardedEdits(scope: DiscardScope, objectIds: string[]): void {
  if (objectIds.length === 0) return;
  const key = storageKey(scope);
  const now = Date.now();
  const record = Object.fromEntries(Object.entries(readRecord(key)).filter(([, entry]) => now - entry.at < RETENTION_MS));

  for (const objectId of objectIds) record[objectId] = { id: uuidv4(), at: now };
  localStorage.setItem(key, JSON.stringify(record));
}

/** Discarded objects this tab has neither reloaded nor confirmed it holds no copy of. */
export function unsettledDiscards(scope: DiscardScope): string[] {
  return Object.entries(readRecord(storageKey(scope)))
    .filter(([, entry]) => isUnsettled(entry))
    .map(([objectId]) => objectId);
}

/** Uploads of an object with an unsettled discard are refused in this tab. */
export function isFencedByDiscard(scope: DiscardScope, objectId: string): boolean {
  return isUnsettled(readRecord(storageKey(scope))[objectId]);
}

/** This tab holds no copy of these discarded objects, so it may upload them again. */
export function settleDiscardedEdits(scope: DiscardScope, objectIds: string[]): void {
  const record = readRecord(storageKey(scope));

  for (const objectId of objectIds) {
    const entry = record[objectId];

    if (entry) settled.add(entry.id);
  }
}

/**
 * Hands this tab's unsettled discards of the scope to its subscribers, after
 * the current call stack (an upload refused inside a document update).
 */
export function requestDiscardSettlement(scope: DiscardScope): void {
  queueMicrotask(() => {
    const objectIds = unsettledDiscards(scope);

    if (objectIds.length === 0) return;
    listeners.get(storageKey(scope))?.forEach((listener) => {
      try {
        listener(objectIds);
      } catch (error) {
        Log.warn('[outbox] discarded-edits listener failed', { error });
      }
    });
  });
}

/**
 * Calls `listener` with this tab's unsettled discards of the scope: right away,
 * when another tab records one, when the page becomes visible again or is
 * restored from the back/forward cache, and when this tab refuses an upload
 * because of one.
 */
export function subscribeDiscardedEdits(scope: DiscardScope, listener: DiscardListener): () => void {
  const key = storageKey(scope);
  const subscribers = listeners.get(key) ?? new Set<DiscardListener>();
  const check = () => {
    const objectIds = unsettledDiscards(scope);

    if (objectIds.length > 0) listener(objectIds);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) check();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') check();
  };

  subscribers.add(listener);
  listeners.set(key, subscribers);
  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', onVisibilityChange);
  check();

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
