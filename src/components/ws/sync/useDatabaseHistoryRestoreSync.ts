import EventEmitter from 'events';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';

import { ERROR_CODE } from '@/application/constants';
import { invalidateDatabaseBlobAfterRestore, prefetchDatabaseBlobDiff } from '@/application/database-blob';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { captureDatabaseStorageFence, db, deleteCollabDB, openCollabDB, openRowCollabDBWithProvider } from '@/application/db';
import { getDatabaseRestoreState } from '@/application/services/domains/database-history';
import { cacheCanonicalRowDoc, getCachedDatabaseRowIds, getCachedRowDatabaseId,
  invalidateDatabaseRowCache } from '@/application/services/js-services/cache';
import { defaultConfig } from '@/application/services/js-services/http/cloud-config';
import { getCollab } from '@/application/services/js-services/http/collab-api';
import { bindSyncContext, SyncContext } from '@/application/services/js-services/sync-protocol';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import { Types, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { notification } from '@/proto/messages';
import { Log } from '@/utils/log';

import { DatabaseRestoreState, DatabaseRestoreTracker } from './databaseRestoreState';
import { rebuildCollabDoc } from './rebuildCollabDoc';
import { SyncRefs } from './syncRefs';
import { RegisterSyncContext, SyncDocMeta } from './types';

export function databaseRowIds(doc: YDoc): string[] {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
  const ids = new Set<string>();

  database?.get(YjsDatabaseKey.views)?.forEach((view) => {
    view.get(YjsDatabaseKey.row_orders)?.toArray().forEach((row: { id: string }) => ids.add(row.id));
  });
  return [...ids];
}

type Dependencies = {
  refs: SyncRefs;
  workspaceId: string;
  enabled?: boolean;
  userId?: string;
  capabilityLoaded?: boolean;
  eventEmitter: EventEmitter;
  register: (context: RegisterSyncContext) => SyncContext;
  unregister: (objectId: string, options?: { flushPending?: boolean }) => void;
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void;
};

export function useDatabaseHistoryRestoreSync(deps: Dependencies) {
  const latest = useRef(deps);

  latest.current = deps;
  const resetting = useRef(new Set<string>());
  const rowDatabases = useRef(new Map<string, string>());
  const resetPlans = useRef(new Map<string, {
    objectIds: string[];
    affected: SyncContext[];
    owners: Map<string, { count: number; cleanup: boolean }>;
    root?: SyncContext;
  }>());
  const retryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const restoreHints = useRef(new Set<string>());
  const sessionActive = useRef(true);
  const retryReset = useRef<(databaseId: string) => Promise<boolean>>();
  const userId = deps.userId || '';
  const nilMarker = '00000000-0000-0000-0000-000000000000';

  const resetDatabase = useCallback(async (databaseId: string, state: DatabaseRestoreState) => {
    const { refs, workspaceId, eventEmitter, register, unregister, scheduleDeferredCleanup } = latest.current;
    const user = refs.latestUserRef.current;

    if (!user || refs.isDisposedRef.current) throw new Error('Database restore session is unavailable');
    const assertSession = () => {
      if (refs.isDisposedRef.current || latest.current.workspaceId !== workspaceId || latest.current.userId !== user.uuid) {
        throw new Error('Database restore session changed');
      }
    };

    const planKey = `${user.uuid}:${workspaceId}:${databaseId}`;
    let plan = resetPlans.current.get(planKey);

    if (!plan) {
      const persistedRows = await db.rows.where('row_key').startsWith(`${databaseId}_rows_`).toArray();

      assertSession();
      // Capture active consumers after the asynchronous cache lookup, so a row
      // opened during that lookup retains its ownership through replacement.
      const contexts = [...refs.registeredContexts.current.values()];
      const root = refs.registeredContexts.current.get(databaseId);
      const rowIds = new Set([...persistedRows.map((row) => row.row_id), ...getCachedDatabaseRowIds(databaseId),
        ...(root ? databaseRowIds(root.doc) : [])]);

      for (const context of contexts) {
        if (context.collabType !== Types.DatabaseRow) continue;
        const row = context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

        if (row?.get(YjsDatabaseKey.database_id) === databaseId) rowIds.add(context.doc.guid);
      }

      for (const id of rowIds) rowDatabases.current.set(id, databaseId);
      const affected = contexts.filter((context) => context.doc.guid === databaseId || rowIds.has(context.doc.guid));
      const owners = new Map(affected.map((context) => [context.doc.guid, {
        count: Math.max(1, refs.contextRefCounts.current.get(context.doc.guid) || 0),
        cleanup: refs.pendingCleanups.current.has(context.doc.guid),
      }]));

      plan = { affected, owners, root, objectIds: [databaseId, ...rowIds] };
      // Retain ownership until reload succeeds. A failed attempt may already
      // have unregistered every context, but its UI consumers still need reset.
      resetPlans.current.set(planKey, plan);
    }

    // A failed attempt may already have rebuilt some consumers. Use those
    // replacement contexts and their current owners on retry, while retaining
    // the original entries for consumers whose row rebuild never completed.
    plan.affected = plan.affected.map((context) => {
      const current = refs.registeredContexts.current.get(context.doc.guid);

      if (!current || current === context) return context;
      plan!.owners.set(current.doc.guid, {
        count: Math.max(1, refs.contextRefCounts.current.get(current.doc.guid) || 0),
        cleanup: refs.pendingCleanups.current.has(current.doc.guid),
      });
      if (current.collabType === Types.Database) plan!.root = current;
      return current;
    });
    const { objectIds, affected, owners, root } = plan;
    const restoreId = state.database_restore_id ?? nilMarker;
    const storageFence = { databaseId, epoch: restoreId, cacheEpoch: restoreId };
    let completed = false;

    resetting.current.add(databaseId);
    for (const objectId of objectIds) refs.resettingObjectIds.current.add(objectId);
    try {
      // CAS the observed cache generation before retiring consumers. A slower
      // tab must re-read authority if another restore already advanced storage.
      await invalidateDatabaseBlobAfterRestore(databaseId, restoreId, state.storageEpoch ?? null);
      assertSession();
      // Retire old asynchronous row opens before any canonical provider is replaced.
      invalidateDatabaseRowCache(databaseId);
      if (root) getOrCreateDatabaseHistoryManager(root.doc).clear();
      for (const objectId of objectIds) {
        const current = refs.registeredContexts.current.get(objectId);

        unregister(objectId, { flushPending: false });
        if (current && !affected.includes(current)) current.doc.destroy();
      }

      const discardStoredCollabs = async (ids: string[]) => {
        for (let offset = 0; offset < ids.length; offset += 16) {
          assertSession();
          await Promise.all(ids.slice(offset, offset + 16).map(async (objectId) => {
            await deleteOutboxByObjectId(objectId, { skipActiveDrain: true,
              preserveDatabaseRestoreId: restoreId, storageFence,
              session: { userId: user.uuid, workspaceId } });
            const deleted = await deleteCollabDB(objectId, { destroyDoc: false, databaseId, databaseRestoreId: restoreId });

            if (!deleted) throw new Error('Could not replace the database cache. Close other tabs and retry.');
            if (objectId !== databaseId) {
              const legacyDeleted = await deleteCollabDB(`${databaseId}_rows_${objectId}`, { destroyDoc: false, databaseId, databaseRestoreId: restoreId });

              if (!legacyDeleted) throw new Error('Could not remove an obsolete database row cache.');
            }
          }));
        }
      };

      await discardStoredCollabs(objectIds);

      for (const context of affected) {
        context.doc.emit('reset', [context, state.version]);
        context.doc.destroy();
      }

      assertSession();
      const rootBytes = await getCollab(workspaceId, databaseId, Types.Database);

      assertSession();
      const nextRoot = await openCollabDB(databaseId, {
        expectedVersion: state.version ?? undefined, currentUser: user.uid, databaseRestoreId: restoreId,
      });

      nextRoot.databaseRestoreId = state.database_restore_id ?? nilMarker;
      Y.applyUpdate(nextRoot, rootBytes.data);
      // Restoring can reintroduce rows that are absent from the current root and
      // were never opened locally. Their old blob cache must not merge into the
      // restored snapshot merely because no row-key mapping was created for it.
      const knownRows = new Set(objectIds);
      const restoredRows = databaseRowIds(nextRoot).filter((rowId) => !knownRows.has(rowId));

      for (const rowId of restoredRows) {
        objectIds.push(rowId);
        rowDatabases.current.set(rowId, databaseId);
        refs.resettingObjectIds.current.add(rowId);
      }

      await discardStoredCollabs(restoredRows);
      // Force the authoritative full blob walk after clearing the RID; restore
      // finalization can keep this pending until the replacement manifest is ready.
      await prefetchDatabaseBlobDiff(workspaceId, databaseId, { forceFullSync: true, reuseSettled: true, requirePersistence: true });
      assertSession();
      for (const context of affected) {
        const objectId = context.doc.guid;
        const ownership = owners.get(objectId)!;

        await rebuildCollabDoc({
          previousDoc: context.doc as YDoc & SyncDocMeta,
          context, eventEmitter, registerSyncContext: register, scheduleDeferredCleanup,
          ownerCount: ownership.count, hadPendingDeferredCleanup: ownership.cleanup, isExternalRevert: true,
          openDoc: async () => {
            if (context.collabType === Types.Database) return nextRoot;
            const { doc } = await openRowCollabDBWithProvider(objectId);

            doc.databaseRestoreId = state.database_restore_id ?? nilMarker;
            cacheCanonicalRowDoc(objectId, doc);
            return doc;
          },
        });
      }

      completed = true;
      resetPlans.current.delete(planKey);
    } finally {
      // Messages queued before/during cutover belong to the discarded branch.
      for (const id of objectIds) {
        refs.queuedMessagesDuringReset.current.delete(id);
        if (completed) refs.resettingObjectIds.current.delete(id);
      }

      resetting.current.delete(databaseId);
    }
  }, []);

  const tracker = useMemo(() => new DatabaseRestoreTracker(
    `af_database_restore:v1:${defaultConfig.baseURL}:${userId}:${deps.workspaceId}:`,
    async (databaseId) => {
      const witness = await captureDatabaseStorageFence(databaseId, { required: true });
      const state = await getDatabaseRestoreState(deps.workspaceId, databaseId);

      return { ...state, storageEpoch: witness.epoch };
    },
    (databaseId, state) => {
      if (latest.current.workspaceId !== deps.workspaceId || latest.current.userId !== userId) {
        throw new Error('Database restore session changed');
      }

      return resetDatabase(databaseId, state);
    }, localStorage
  ), [deps.workspaceId, userId, resetDatabase]);

  const resolveDatabase = useCallback(async (objectId: string, type: Types): Promise<string | undefined> => {
    if (type === Types.Database) return objectId;
    if (type !== Types.DatabaseRow) return undefined;
    const known = rowDatabases.current.get(objectId) || getCachedRowDatabaseId(objectId);

    if (known) return known;
    const context = latest.current.refs.registeredContexts.current.get(objectId);
    const row = context?.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
    let databaseId = row?.get(YjsDatabaseKey.database_id) as string | undefined;

    if (!databaseId) {
      // Older caches have only row_key as an index. Cache the reverse mapping
      // once; newly opened rows populate getCachedRowDatabaseId directly.
      const record = await db.rows.filter((item) => item.row_id === objectId).first();

      databaseId = record?.row_key.split('_rows_')[0];
    }

    if (databaseId) rowDatabases.current.set(objectId, databaseId);
    return databaseId;
  }, []);

  const ensureDatabaseRestoreCurrent = useCallback(async (objectId: string, type: Types, expectedMarker?: string): Promise<boolean> => {
    if (type !== Types.Database && type !== Types.DatabaseRow) return true;
    const current = latest.current;

    if (current.refs.isDisposedRef.current || current.capabilityLoaded === false) return false;
    if (!current.enabled) return true;
    const databaseId = await resolveDatabase(objectId, type);

    if (!databaseId || resetting.current.has(databaseId)) return false;
    try {
      const unchanged = await tracker.check(databaseId);
      const retryKey = `${current.userId}:${current.workspaceId}:${databaseId}`;
      const retryTimer = retryTimers.current.get(retryKey);

      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimers.current.delete(retryKey);
      restoreHints.current.delete(retryKey);

      if (!unchanged) {
        for (const context of current.refs.registeredContexts.current.values()) {
          if (context.doc.guid === databaseId || rowDatabases.current.get(context.doc.guid) === databaseId) {
            bindSyncContext(context);
          }
        }

        return false;
      }

      const marker = tracker.marker(databaseId) ?? nilMarker;

      if (expectedMarker !== undefined && expectedMarker !== marker) {
        const owner = current.refs.latestUserRef.current;

        if (owner) {
          await db.sync_outbox.where('[userId+workspaceId+objectId]')
            .equals([owner.uuid, current.workspaceId, objectId])
            .filter((record) => (record.databaseRestoreId ?? nilMarker) !== marker).delete();
        }

        return false;
      }

      return true;
    } catch (error) {
      Log.warn('[DatabaseHistory] Restore state verification failed; sync remains queued', { databaseId, error });
      const retryKey = `${current.userId}:${current.workspaceId}:${databaseId}`;

      const detail = error as { code?: number; httpStatus?: number; retryAfterSecs?: number } | null;
      const permanentCodes: number[] = [401, 403, 404, ERROR_CODE.NOT_LOGGED_IN, ERROR_CODE.NOT_HAS_PERMISSION,
        ERROR_CODE.USER_UNAUTHORIZED, ERROR_CODE.RECORD_NOT_FOUND, ERROR_CODE.RECORD_DELETED,
        ERROR_CODE.WORKSPACE_NOT_FOUND, ERROR_CODE.FEATURE_NOT_AVAILABLE];
      const permanentlyDenied = permanentCodes.includes(detail?.code ?? 0) ||
        [401, 403, 404].includes(detail?.httpStatus ?? 0);

      if (permanentlyDenied) {
        const timer = retryTimers.current.get(retryKey);

        if (timer !== undefined) clearTimeout(timer);
        retryTimers.current.delete(retryKey);
        restoreHints.current.delete(retryKey);
        return false;
      }

      const hasActiveContext = [...current.refs.registeredContexts.current.values()].some((context) =>
        context.doc.guid === databaseId || (context.collabType === Types.DatabaseRow &&
          (rowDatabases.current.get(context.doc.guid) || getCachedRowDatabaseId(context.doc.guid) ||
            context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)?.get(YjsDatabaseKey.database_id)) === databaseId));
      // Publication can temporarily fence the first marker read, before a reset
      // plan exists. Retain that hint so passive tabs retry even without edits,
      // reconnect, or another incoming root frame to rediscover the restore.
      const needsRetry = hasActiveContext || restoreHints.current.has(retryKey) || resetPlans.current.has(retryKey);

      if (needsRetry && sessionActive.current && !current.refs.isDisposedRef.current &&
          latest.current.workspaceId === current.workspaceId && latest.current.userId === current.userId &&
          !retryTimers.current.has(retryKey)) {
        const delayMs = Math.max(5000, (detail?.retryAfterSecs || 0) * 1000);

        retryTimers.current.set(retryKey, setTimeout(() => {
          retryTimers.current.delete(retryKey);
          if (sessionActive.current && latest.current.workspaceId === current.workspaceId && latest.current.userId === current.userId) {
            void retryReset.current?.(databaseId);
          }
        }, delayMs));
      }

      return false;
    }
  }, [resolveDatabase, tracker]);

  retryReset.current = (databaseId) => ensureDatabaseRestoreCurrent(databaseId, Types.Database);

  useEffect(() => {
    const timers = retryTimers.current;
    const hints = restoreHints.current;

    sessionActive.current = true;
    return () => {
      sessionActive.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      hints.clear();
    };
  }, [deps.workspaceId, userId]);

  const reloadDatabaseAfterRestore = useCallback(async (databaseId: string, _restoreId: string) => {
    await ensureDatabaseRestoreCurrent(databaseId, Types.Database);
    // A failed check is deliberately swallowed for background drains; the UI
    // needs an error so it never reports completion before reload succeeds.
    await tracker.check(databaseId);
  }, [tracker, ensureDatabaseRestoreCurrent]);

  const handleRestoreNotification = useCallback((value?: notification.IDatabaseRestored | null) => {
    if (!latest.current.enabled || !value?.databaseId || !value.databaseRestoreId) return;
    restoreHints.current.add(`${latest.current.userId}:${latest.current.workspaceId}:${value.databaseId}`);
    void ensureDatabaseRestoreCurrent(value.databaseId, Types.Database);
  }, [ensureDatabaseRestoreCurrent]);

  useEffect(() => {
    const verifyOpenDatabases = () => {
      const databaseIds = new Set<string>();
      const prefix = `${deps.userId}:${deps.workspaceId}:`;

      for (const key of resetPlans.current.keys()) {
        if (key.startsWith(prefix)) databaseIds.add(key.slice(prefix.length));
      }

      for (const context of deps.refs.registeredContexts.current.values()) {
        if (context.collabType === Types.Database) {
          databaseIds.add(context.doc.guid);
        }
      }

      for (const databaseId of databaseIds) void ensureDatabaseRestoreCurrent(databaseId, Types.Database);
    };

    window.addEventListener('online', verifyOpenDatabases);
    window.addEventListener('focus', verifyOpenDatabases);
    return () => {
      window.removeEventListener('online', verifyOpenDatabases);
      window.removeEventListener('focus', verifyOpenDatabases);
    };
  }, [deps.refs, deps.workspaceId, deps.userId, ensureDatabaseRestoreCurrent]);

  const prepareDatabaseContext = useCallback((context: RegisterSyncContext) => {
    if (!latest.current.enabled || context.doc.databaseRestoreId !== undefined) return;
    const databaseId = context.collabType === Types.Database ? context.doc.guid :
      context.collabType === Types.DatabaseRow ? getCachedRowDatabaseId(context.doc.guid) ||
        context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)?.get(YjsDatabaseKey.database_id) : undefined;

    if (context.collabType === Types.Database || context.collabType === Types.DatabaseRow) {
      context.doc.databaseRestoreId = databaseId ? tracker.marker(databaseId) ?? nilMarker : nilMarker;
    }
  }, [tracker]);

  return { ensureDatabaseRestoreCurrent, reloadDatabaseAfterRestore, handleRestoreNotification, prepareDatabaseContext };
}
