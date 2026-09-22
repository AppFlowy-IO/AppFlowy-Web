import EventEmitter from 'events';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { invalidateDatabaseBlobAfterRestore, prefetchDatabaseBlobDiff } from '@/application/database-blob';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { captureDatabaseStorageFence, db, deleteCollabDB, matchesDatabaseStorageFence, openCollabDB, openRowCollabDBWithProvider,
  readDatabaseIdFromRowCache } from '@/application/db';
import { DATABASE_RESTORE_MARKER_PREFIX } from '@/application/db/database-storage-fence';
import { getDatabaseRestoreState } from '@/application/services/domains/database-history';
import { cacheCanonicalRowDoc, getCachedDatabaseRowIds, getCachedRowDatabaseId,
  invalidateDatabaseRowCache } from '@/application/services/js-services/cache';
import { defaultConfig } from '@/application/services/js-services/http/cloud-config';
import { getCollab } from '@/application/services/js-services/http/collab-api';
import { bindSyncContext, SyncContext } from '@/application/services/js-services/sync-protocol';
import { deleteOutboxByObjectId, startDrainAll } from '@/application/sync-outbox';
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
  const deferredSync = useRef(new Set<string>());
  const restoreHints = useRef(new Set<string>());
  // A restore observed in this session must keep fencing later traffic even
  // after its retry hint is consumed or the history UI capability is disabled.
  const observedRestores = useRef(new Set<string>());
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
        ...[...rowDatabases.current].filter(([, parentId]) => parentId === databaseId).map(([rowId]) => rowId),
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

    const { objectIds, owners } = plan;
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

      // Invalidation can wait for a prefetch while consumers register or change
      // ownership. Capture them immediately before teardown, retaining entries
      // whose replacement failed on an earlier attempt and is still pending.
      const affectedById = new Map(plan.affected.map((context) => [context.doc.guid, context]));
      const knownObjectIds = new Set(objectIds);
      const currentRoot = refs.registeredContexts.current.get(databaseId);

      for (const rowId of [...getCachedDatabaseRowIds(databaseId), ...(currentRoot ? databaseRowIds(currentRoot.doc) : [])]) {
        knownObjectIds.add(rowId);
      }

      for (const context of refs.registeredContexts.current.values()) {
        const objectId = context.doc.guid;

        if (objectId !== databaseId) {
          if (context.collabType !== Types.DatabaseRow) continue;
          const parentId = rowDatabases.current.get(objectId) || getCachedRowDatabaseId(objectId) ||
            context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)?.get(YjsDatabaseKey.database_id);

          if (!knownObjectIds.has(objectId) && parentId !== databaseId) continue;
        }

        knownObjectIds.add(objectId);
        affectedById.set(objectId, context);
        owners.set(objectId, {
          count: Math.max(1, refs.contextRefCounts.current.get(objectId) || 0),
          cleanup: refs.pendingCleanups.current.has(objectId),
        });
      }

      objectIds.length = 0;
      for (const objectId of knownObjectIds) {
        objectIds.push(objectId);
        refs.resettingObjectIds.current.add(objectId);
        if (objectId !== databaseId) rowDatabases.current.set(objectId, databaseId);
      }

      const affected = [...affectedById.values()];

      plan.affected = affected;
      plan.root = currentRoot ?? plan.root;
      // Retire old asynchronous row opens before any canonical provider is replaced.
      invalidateDatabaseRowCache(databaseId);
      if (plan.root) getOrCreateDatabaseHistoryManager(plan.root.doc).clear();
      for (const objectId of objectIds) {
        unregister(objectId, { flushPending: false });
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
      // Sidebar membership lives in Folder, separately from the replaced Database document.
      // Refresh it for both the initiating tab and followers that observed a restore marker.
      eventEmitter.emit(APP_EVENTS.DATABASE_RESTORED, { workspaceId, databaseId, restoreId });
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
    `${DATABASE_RESTORE_MARKER_PREFIX}v1:${defaultConfig.baseURL}:${userId}:${deps.workspaceId}:`,
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

    // Modern rows need not have a legacy row_key index. A socket owner or a
    // restarted tab can recover their parent from the shared snapshot and tail.
    if (!databaseId) databaseId = await readDatabaseIdFromRowCache(objectId);
    if (databaseId) rowDatabases.current.set(objectId, databaseId);
    return databaseId;
  }, []);

  const ensureDatabaseRestoreCurrent = useCallback(async (
    objectId: string, type: Types, expectedMarker?: string, rootVersionChanged = false
  ): Promise<boolean> => {
    if (type !== Types.Database && type !== Types.DatabaseRow) return true;
    const current = latest.current;

    if (current.refs.isDisposedRef.current) return false;
    if (!current.enabled && !rootVersionChanged &&
        (expectedMarker === undefined || expectedMarker === nilMarker) &&
        !tracker.hasRestoreEvidence() && observedRestores.current.size === 0) {
      return current.capabilityLoaded !== false;
    }

    let databaseId: string | undefined;

    try {
      databaseId = await resolveDatabase(objectId, type);
      const scopeKey = `${current.userId}:${current.workspaceId}:${databaseId}`;

      if (databaseId && type === Types.Database && rootVersionChanged) {
        observedRestores.current.add(scopeKey);
        // A collab version is only evidence to reread authority, never a database restore ID.
        tracker.observeRestoreHint(databaseId);
      }

      if (databaseId && expectedMarker !== undefined && expectedMarker !== nilMarker) {
        observedRestores.current.add(scopeKey);
        if (expectedMarker !== tracker.marker(databaseId)) tracker.observeRestoreHint(databaseId, expectedMarker);
      }

      const hasRestoreEvidence = databaseId &&
        (observedRestores.current.has(scopeKey) || tracker.marker(databaseId) !== null);

      // Capabilities advertise UI/ordinary sync support. An authoritative restore
      // hint or an already-stamped database still requires aggregate recovery.
      if (!hasRestoreEvidence) {
        if (current.capabilityLoaded === false) return false;
        if (!current.enabled) return true;
      }

      if (!databaseId || resetting.current.has(databaseId)) return false;
      let unchanged = true;

      do {
        unchanged = await tracker.check(databaseId) && unchanged;
      } while (!tracker.verificationIsCurrent(databaseId));

      if (!sessionActive.current || current.refs.isDisposedRef.current ||
          latest.current.workspaceId !== current.workspaceId || latest.current.userId !== current.userId) return false;
      const retryKey = `${current.userId}:${current.workspaceId}:${databaseId}`;
      const retryTimer = retryTimers.current.get(retryKey);

      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimers.current.delete(retryKey);
      restoreHints.current.delete(retryKey);

      // A failed guard may have dropped the only manifest exchange. Recover
      // once per database even when its restore marker has not changed, and
      // consume this before binding because outgoing frames verify again.
      const resumeDeferredSync = deferredSync.current.delete(retryKey);

      if (!unchanged || resumeDeferredSync) {
        for (const context of current.refs.registeredContexts.current.values()) {
          if (context.doc.guid === databaseId || (context.collabType === Types.DatabaseRow &&
              (rowDatabases.current.get(context.doc.guid) || getCachedRowDatabaseId(context.doc.guid) ||
                context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)?.get(YjsDatabaseKey.database_id)) === databaseId)) {
            bindSyncContext(context);
          }
        }

        startDrainAll();
      }

      if (!unchanged) return false;
      const marker = tracker.marker(databaseId) ?? nilMarker;

      if (expectedMarker !== undefined && expectedMarker !== marker) {
        const owner = current.refs.latestUserRef.current;

        if (owner) {
          const fence = await captureDatabaseStorageFence(databaseId, { required: true });

          // A delayed response can still match this tab's tracker after a
          // sibling has advanced storage. Never discard that sibling's edits.
          if ((fence.epoch ?? nilMarker) !== marker) return false;
          await db.transaction('rw', db.sync_outbox, db.collab_custom, async () => {
            // Hold the generation and outbox write locks together, including
            // when a restore commits after the preliminary fence read.
            if (!(await matchesDatabaseStorageFence(fence))) return;
            await db.sync_outbox.where('[userId+workspaceId+objectId]')
              .equals([owner.uuid, current.workspaceId, objectId])
              .filter((record) => (record.databaseRestoreId ?? nilMarker) !== marker).delete();
          });
        }

        return false;
      }

      return true;
    } catch (error) {
      Log.warn('[DatabaseHistory] Restore state verification failed; sync remains queued', { databaseId, error });
      if (!databaseId) return false;
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
        deferredSync.current.delete(retryKey);
        return false;
      }

      if (sessionActive.current && !current.refs.isDisposedRef.current &&
          latest.current.workspaceId === current.workspaceId && latest.current.userId === current.userId) {
        deferredSync.current.add(retryKey);
      }

      const hasActiveContext = [...current.refs.registeredContexts.current.values()].some((context) =>
        context.doc.guid === databaseId || (context.collabType === Types.DatabaseRow &&
          (rowDatabases.current.get(context.doc.guid) || getCachedRowDatabaseId(context.doc.guid) ||
            context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)?.get(YjsDatabaseKey.database_id)) === databaseId));
      // Pre-send checks can block an outbox owned by another tab, with no local
      // context or restore hint. Its deferred sync still needs a retry to drain.
      const needsRetry = deferredSync.current.has(retryKey) || hasActiveContext ||
        restoreHints.current.has(retryKey) || resetPlans.current.has(retryKey);

      if (needsRetry && sessionActive.current && !current.refs.isDisposedRef.current &&
          latest.current.workspaceId === current.workspaceId && latest.current.userId === current.userId &&
          !retryTimers.current.has(retryKey)) {
        const delayMs = Math.max(5000, (detail?.retryAfterSecs || 0) * 1000);
        const retryDatabaseId = databaseId;

        retryTimers.current.set(retryKey, setTimeout(() => {
          retryTimers.current.delete(retryKey);
          if (sessionActive.current && latest.current.workspaceId === current.workspaceId && latest.current.userId === current.userId) {
            void retryReset.current?.(retryDatabaseId);
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
    const deferred = deferredSync.current;
    const observed = observedRestores.current;

    sessionActive.current = true;
    return () => {
      sessionActive.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      hints.clear();
      deferred.clear();
      observed.clear();
    };
  }, [deps.workspaceId, userId]);

  const reloadDatabaseAfterRestore = useCallback(async (databaseId: string, _restoreId: string) => {
    await ensureDatabaseRestoreCurrent(databaseId, Types.Database);
    // A failed check is deliberately swallowed for background drains; the UI
    // needs an error so it never reports completion before reload succeeds.
    await tracker.check(databaseId);
  }, [tracker, ensureDatabaseRestoreCurrent]);

  const handleRestoreNotification = useCallback((value?: notification.IDatabaseRestored | null) => {
    if (!sessionActive.current || latest.current.refs.isDisposedRef.current ||
        !value?.databaseId || !value.databaseRestoreId) return;
    const scopeKey = `${latest.current.userId}:${latest.current.workspaceId}:${value.databaseId}`;

    observedRestores.current.add(scopeKey);
    restoreHints.current.add(scopeKey);
    tracker.observeRestoreHint(value.databaseId, value.databaseRestoreId);
    void ensureDatabaseRestoreCurrent(value.databaseId, Types.Database);
  }, [ensureDatabaseRestoreCurrent, tracker]);

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
    if (context.doc.databaseRestoreId !== undefined) return;
    const databaseId = context.collabType === Types.Database ? context.doc.guid :
      context.collabType === Types.DatabaseRow ? getCachedRowDatabaseId(context.doc.guid) ||
        context.doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)?.get(YjsDatabaseKey.database_id) : undefined;
    const hasRestoreEvidence = databaseId && (tracker.marker(databaseId) !== null ||
      observedRestores.current.has(`${latest.current.userId}:${latest.current.workspaceId}:${databaseId}`));

    if (!latest.current.enabled && !hasRestoreEvidence) return;

    if (context.collabType === Types.Database || context.collabType === Types.DatabaseRow) {
      context.doc.databaseRestoreId = databaseId ? tracker.marker(databaseId) ?? nilMarker : nilMarker;
    }
  }, [tracker]);

  return { ensureDatabaseRestoreCurrent, reloadDatabaseAfterRestore, handleRestoreNotification, prepareDatabaseContext };
}
