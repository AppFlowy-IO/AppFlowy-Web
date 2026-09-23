import { db } from '@/application/db';
import { SyncOutboxRecord } from '@/application/db/tables/sync_outbox';
import { SyncReceiptRecord } from '@/application/db/tables/sync_receipts';
import { changeSyncCounts, markSyncReady, resetSyncStatus, setSyncParent } from '@/application/sync-status/store';
import { collab } from '@/proto/messages';
import { Log } from '@/utils/log';

interface Pending {
  objectId: string;
  version?: string | null;
  id?: number;
  enqueueSettled: boolean;
  accepted: boolean;
  retryRequired: boolean;
  saved: boolean;
  error: boolean;
  receiptKeys: Set<string>;
}

const pending = new Map<string, Pending>();
const byReceipt = new Map<string, Set<string>>();
const earlySaved = new Set<string>();
const sent = new Set<string>();
const settled = new Set<string>();
const awaitingAcceptance = new Set<string>();
let acceptanceTimer: ReturnType<typeof setTimeout> | undefined;
let acceptanceRetryDelay = 5_000;
let acceptanceGeneration = 0;
let sessionKey = '';
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let cleanupAfter = 0;
let retryDelay = 5 * 60_000;
let retry: ((objectId?: string, wake?: boolean) => void) | undefined;

function receiptKey(objectId: string, version: string | null | undefined, rid: collab.IRid) {
  // Protobuf uint64s are Longs. Converting to Number would lose precision.
  return `${objectId}\u0000${version ?? ''}\u0000${rid.timestamp?.toString() ?? '0'}-${rid.counter ?? 0}`;
}

function clearAcceptanceTimer() {
  if (acceptanceTimer) clearTimeout(acceptanceTimer);
  acceptanceTimer = undefined;
}

function stopWaitingForAcceptance(id: string) {
  awaitingAcceptance.delete(id);
  if (!awaitingAcceptance.size) {
    clearAcceptanceTimer();
    acceptanceRetryDelay = 5_000;
  }
}

function scheduleAcceptanceRecovery() {
  if (acceptanceTimer || !awaitingAcceptance.size || !retry) return;
  acceptanceTimer = setTimeout(() => {
    acceptanceTimer = undefined;
    const generation = acceptanceGeneration;
    const ids = Array.from(awaitingAcceptance);

    // Only missing acceptance needs a short timeout. Accepted edits can wait for the Worker
    // without being uploaded again. Consult sibling-tab proof before retrying lost ACKs.
    void refreshSyncReceipts(ids).then(() => {
      if (generation !== acceptanceGeneration) return;
      const objects = new Set<string>();

      for (const id of ids) {
        if (!awaitingAcceptance.delete(id)) continue;
        sent.delete(id);
        objects.add(pending.get(id)!.objectId);
      }

      if (objects.size) {
        acceptanceRetryDelay = Math.min(acceptanceRetryDelay * 2, 30_000);
        objects.forEach((objectId) => retry?.(objectId));
      }

      scheduleAcceptanceRecovery();
    });
  }, acceptanceRetryDelay);
}

function scheduleRecovery() {
  if (retryTimer || !pending.size || !retry) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    const key = sessionKey;

    void refreshSyncReceipts().then(() => {
      if (key !== sessionKey) return;
      if (pending.size) {
        sent.clear();
        retry?.();
        retryDelay = Math.min(retryDelay * 2, 30 * 60_000);
      }

      scheduleRecovery();
    });
  }, retryDelay);
}

export function configureReceiptRecovery(callback: ((objectId?: string, wake?: boolean) => void) | undefined) {
  acceptanceGeneration++;
  clearAcceptanceTimer();
  retry = callback;
  if (!callback && retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  scheduleRecovery();
  scheduleAcceptanceRecovery();
}

export function resetReceiptSession(key: string) {
  if (sessionKey === key) return;
  sessionKey = key;
  pending.clear();
  settled.clear();
  byReceipt.clear();
  earlySaved.clear();
  sent.clear();
  awaitingAcceptance.clear();
  acceptanceGeneration++;
  clearAcceptanceTimer();
  acceptanceRetryDelay = 5_000;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  retryDelay = 5 * 60_000;
  resetSyncStatus();
}

/** Retains only identities and counters in memory; payloads stay in IndexedDB. */
export function trackSyncRecord(record: SyncOutboxRecord) {
  if (!record.syncId || settled.has(record.syncId) || sessionKey !== `${record.userId}\u0000${record.workspaceId}`)
    return;
  let parent = record.objectId;

  for (const ancestor of record.syncAncestors ?? []) {
    setSyncParent(parent, ancestor);
    parent = ancestor;
  }

  let entry = pending.get(record.syncId);

  if (!entry) {
    entry = {
      objectId: record.objectId,
      version: record.version,
      enqueueSettled: false,
      accepted: false,
      retryRequired: false,
      saved: false,
      error: false,
      receiptKeys: new Set(),
    };
    pending.set(record.syncId, entry);
    changeSyncCounts(record.objectId, 1, 0);
  }

  if (record.id !== undefined) {
    entry.id = record.id;
    entry.enqueueSettled = true;
    if (entry.saved) void finishSaved([record.syncId]);
  }

  scheduleRecovery();
}

export function markSyncSent(ids: string[]) {
  for (const id of ids) {
    sent.add(id);
    const entry = pending.get(id);

    if (entry && !entry.accepted && !entry.saved && !entry.error) awaitingAcceptance.add(id);
  }

  scheduleAcceptanceRecovery();
}

export function wasSyncSent(record: SyncOutboxRecord) {
  return !!record.syncId && (sent.has(record.syncId) || settled.has(record.syncId));
}

export function resetSyncDelivery() {
  sent.clear();
  awaitingAcceptance.clear();
  acceptanceGeneration++;
  clearAcceptanceTimer();
  acceptanceRetryDelay = 5_000;
}

export function markSyncError(syncId: string) {
  const entry = pending.get(syncId);

  if (!entry || entry.error) return;
  entry.enqueueSettled = true;
  entry.error = true;
  stopWaitingForAcceptance(syncId);
  if (entry.saved) void finishSaved([syncId]);
  changeSyncCounts(entry.objectId, 0, 0, 1);
}

function forget(id: string, entry: Pending) {
  pending.delete(id);
  settled.add(id);
  if (settled.size > 8192) settled.delete(settled.values().next().value);
  sent.delete(id);
  stopWaitingForAcceptance(id);
  for (const key of entry.receiptKeys) {
    const ids = byReceipt.get(key);

    ids?.delete(id);
    if (!ids?.size) byReceipt.delete(key);
  }

  changeSyncCounts(entry.objectId, -1, entry.accepted ? -1 : 0, entry.error ? -1 : 0);
  if (!pending.size && retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    retryDelay = 5 * 60_000;
  }
}

export function discardSyncObject(objectId: string) {
  for (const [id, entry] of pending) {
    if (entry.objectId === objectId) forget(id, entry);
  }
}

function receiptRecord(id: string, entry: Pending, receiptKey: string): SyncReceiptRecord {
  const [userId, workspaceId] = sessionKey.split('\u0000');

  return {
    syncId: id,
    userId,
    workspaceId,
    objectId: entry.objectId,
    version: entry.version,
    receiptKey,
    savedAt: entry.saved ? Date.now() : 0,
  };
}

function linkReceipt(id: string, entry: Pending, key: string) {
  entry.receiptKeys.add(key);
  if (entry.receiptKeys.size > 8) {
    const expired = entry.receiptKeys.values().next().value!;

    entry.receiptKeys.delete(expired);
    const olderIds = byReceipt.get(expired);

    olderIds?.delete(id);
    if (!olderIds?.size) byReceipt.delete(expired);
  }

  const ids = byReceipt.get(key) ?? new Set<string>();

  ids.add(id);
  byReceipt.set(key, ids);
}

function restoreReceipt(receipt: SyncReceiptRecord): string[] {
  if (`${receipt.userId}\u0000${receipt.workspaceId}` !== sessionKey) return [];
  const entry = pending.get(receipt.syncId);

  if (!entry || entry.objectId !== receipt.objectId || (entry.version ?? '') !== (receipt.version ?? '')) return [];
  if (!entry.accepted && !entry.retryRequired) {
    entry.accepted = true;
    changeSyncCounts(entry.objectId, 0, 1);
  }

  if (entry.accepted) stopWaitingForAcceptance(receipt.syncId);
  linkReceipt(receipt.syncId, entry, receipt.receiptKey);
  if (receipt.savedAt || earlySaved.has(receipt.receiptKey)) {
    entry.saved = true;
    return [receipt.syncId];
  }

  return [];
}

async function rememberAccepted(records: SyncReceiptRecord[]) {
  const key = sessionKey;

  if (!records.length) return;
  try {
    const stored = await db.transaction('rw', db.sync_receipts, async () => {
      const previous = await db.sync_receipts.bulkGet(records.map((record) => record.syncId));

      // A delayed ACK in another tab must never downgrade saved evidence.
      const retained = records.map((record, index) => (previous[index]?.savedAt ? previous[index]! : record));

      await db.sync_receipts.bulkPut(retained);
      return retained;
    });

    if (key === sessionKey) await finishSaved(stored.flatMap(restoreReceipt));
  } catch (error) {
    Log.warn('[outbox] receipt cache unavailable; retaining live confirmation tracking', error);
  }
}

async function forgetRejectedAcceptance(rejected: Map<string, Set<string>>) {
  if (!rejected.size) return;
  const [userId, workspaceId] = sessionKey.split('\u0000');

  try {
    await db.transaction('rw', db.sync_receipts, async () => {
      const records = await db.sync_receipts.bulkGet([...rejected.keys()]);
      const ids = records.flatMap((record) =>
        record &&
        !record.savedAt &&
        record.userId === userId &&
        record.workspaceId === workspaceId &&
        rejected.get(record.syncId)?.has(record.receiptKey)
          ? [record.syncId]
          : []
      );

      await db.sync_receipts.bulkDelete(ids);
    });
  } catch (error) {
    // A live rejection also blocks cached acceptance in this tab if IndexedDB is unavailable.
    Log.warn('[outbox] rejected acceptance cleanup failed; retaining local retry state', error);
  }
}

/** Recover missed cross-tab confirmations using small metadata, never the update payloads. */
export async function refreshSyncReceipts(ids = Array.from(pending.keys())) {
  const key = sessionKey;

  try {
    for (let offset = 0; offset < ids.length; offset += 128) {
      const receipts = await db.sync_receipts.bulkGet(ids.slice(offset, offset + 128));

      if (key !== sessionKey) return;
      const completed: string[] = [];

      for (const receipt of receipts) {
        if (receipt) completed.push(...restoreReceipt(receipt));
      }

      await finishSaved(completed);
    }

    if (Date.now() >= cleanupAfter) {
      cleanupAfter = Date.now() + 60 * 60_000;
      // Pending evidence is retained. Completed metadata is only a recovery cache.
      await db.sync_receipts
        .where('savedAt')
        .between(1, Date.now() - 24 * 60 * 60_000)
        .delete();
    }
  } catch (error) {
    Log.warn('[outbox] receipt recovery unavailable', error);
  }
}

async function finishSaved(ids: string[]) {
  const key = sessionKey;
  const entries = Array.from(new Set(ids)).flatMap((id) => {
    const entry = pending.get(id);

    return entry?.saved && entry.enqueueSettled ? [{ id, entry }] : [];
  });

  if (!entries.length) return;
  // Saved entries were linked by acceptance or restored proof before reaching
  // this point. Capture their complete metadata before yielding to IndexedDB.
  const records = entries.map(({ id, entry }) => receiptRecord(id, entry, Array.from(entry.receiptKeys).pop()!));

  try {
    await db.transaction('rw', db.sync_outbox, db.sync_receipts, async () => {
      // Persist proof and retire the outbox atomically. A suspended sibling can
      // recover confirmation even after the original payload has been deleted.
      await db.sync_receipts.bulkPut(records);
      await db.sync_outbox.bulkDelete(entries.flatMap(({ entry }) => (entry.id === undefined ? [] : [entry.id])));
    });
    if (key !== sessionKey) return;
    for (const { id, entry } of entries) {
      if (pending.get(id) !== entry) continue;
      markSyncReady(entry.objectId);
      forget(id, entry);
    }
  } catch (error) {
    Log.warn('[outbox] saved receipt cleanup failed; retaining updates for recovery', error);
  }
}

/** Accepts only exact object/version/RID evidence. A later RID never covers an earlier hole. */
export async function receiveSyncReceipt(workspaceId: string, message: collab.ICollabMessage) {
  if (!sessionKey.endsWith(`\u0000${workspaceId}`) || !message.objectId || !message.syncReceipt) return;
  const receipt = message.syncReceipt;
  const objectId = message.objectId;
  const keyAtReceive = sessionKey;
  const completed: string[] = [];

  if (receipt.stage === collab.SyncReceipt.Stage.ACCEPTED && receipt.messageIds?.length === 1) {
    const accepted: SyncReceiptRecord[] = [];

    for (const id of receipt.syncIds ?? []) {
      const entry = pending.get(id);

      if (!entry || entry.objectId !== objectId || (entry.version && entry.version !== receipt.version)) continue;
      const key = receiptKey(objectId, entry.version ? receipt.version : undefined, receipt.messageIds[0]);

      entry.retryRequired = false;
      if (!entry.accepted) {
        entry.accepted = true;
        changeSyncCounts(objectId, 0, 1);
      }

      stopWaitingForAcceptance(id);
      linkReceipt(id, entry, key);
      if (earlySaved.has(key)) {
        entry.saved = true;
        completed.push(id);
      }

      accepted.push(receiptRecord(id, entry, key));
    }

    await rememberAccepted(accepted);
  } else if (receipt.stage === collab.SyncReceipt.Stage.SAVED) {
    const [userId, sessionWorkspaceId] = keyAtReceive.split('\u0000');
    const keys = (receipt.messageIds ?? []).flatMap((rid) => [
      [userId, sessionWorkspaceId, receiptKey(objectId, receipt.version, rid)],
      [userId, sessionWorkspaceId, receiptKey(objectId, undefined, rid)],
    ]);

    if (keys.length) {
      try {
        const saved: SyncReceiptRecord[] = [];

        await db.transaction('rw', db.sync_receipts, async () => {
          await db.sync_receipts
            .where('[userId+workspaceId+receiptKey]')
            .anyOf(keys)
            .modify((record) => {
              record.savedAt = Date.now();
              saved.push(record);
            });
        });
        // The indexed query touches only identities covered by this receipt,
        // even when this tab missed their original ACCEPTED notification.
        if (keyAtReceive === sessionKey) completed.push(...saved.flatMap(restoreReceipt));
      } catch (error) {
        Log.warn('[outbox] shared saved receipt cache unavailable', error);
      }
    }

    if (keyAtReceive !== sessionKey) return;
    for (const rid of receipt.messageIds ?? []) {
      const key = receiptKey(objectId, receipt.version, rid);
      const unversionedKey = receiptKey(objectId, undefined, rid);
      const ids = new Set([...(byReceipt.get(key) ?? []), ...(byReceipt.get(unversionedKey) ?? [])]);

      earlySaved.add(key);
      earlySaved.add(unversionedKey);
      while (earlySaved.size > 512) earlySaved.delete(earlySaved.values().next().value);
      for (const id of ids) {
        const entry = pending.get(id);

        if (entry) entry.saved = true;
        completed.push(id);
      }
    }
  } else if (receipt.stage === collab.SyncReceipt.Stage.RETRY) {
    // Make rejected attempts eligible for the accompanying repair Manifest's
    // drain. Do not wake the sender here: that would create a rejection loop.
    const rejected = new Map<string, Set<string>>();

    for (const id of receipt.syncIds ?? []) {
      const entry = pending.get(id);

      if (entry?.objectId !== objectId) continue;
      entry.retryRequired = true;
      rejected.set(id, new Set(entry.receiptKeys));
      sent.delete(id);
      stopWaitingForAcceptance(id);
      if (entry.accepted) {
        entry.accepted = false;
        changeSyncCounts(objectId, 0, -1);
      }
    }

    if (rejected.size) {
      // A rejected dependent update may follow a lost predecessor that the server never saw.
      // Let the repair drain resend all unaccepted edits for this object, including that hole.
      for (const [id, entry] of pending) {
        if (entry.objectId === objectId && !entry.accepted) {
          sent.delete(id);
          stopWaitingForAcceptance(id);
        }
      }

      retry?.(objectId, false);
    }

    await forgetRejectedAcceptance(rejected);
  }

  if (keyAtReceive === sessionKey) await finishSaved(completed);
}
