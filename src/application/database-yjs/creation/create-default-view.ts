import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import {
  assertAtomicCreationAvailable,
  atomicRead,
  captureAtomicCreationOwner,
  findPendingAtomicCreation,
  parseAtomicCreationRequest,
  recoverAtomicCreation,
  runAtomicCreation,
} from '@/application/atomic-creation';
import type { CreateDefaultDatabaseViewRequest } from '@/application/atomic-creation';
import {
  captureDatabaseStorageFence,
  matchesDatabaseStorageFence,
  publishWithDatabaseStorageFence,
} from '@/application/db';
import { isDatabaseStorageFenceCurrent, withDatabaseStorageFence } from '@/application/db/database-storage-fence';
import { readCollabStates } from '@/application/services/js-services/http/collab-api';
import { DatabaseViewLayout, Types, View, ViewLayout, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';

import { waitForCreatedDatabaseView } from './created-view-readiness';
import { writeCollabDashboardOwner } from '../database-view-doc-ops';
import {
  assertNotAborted,
  DatabaseViewSourceRequirements,
  ORIGINAL_DATABASE_RESTORE_ID,
  readPersistedDatabaseSource,
  remoteDatabaseCoversSource,
  waitForDatabaseViewSource,
} from './source-readiness';

const LAYOUTS = [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar, ViewLayout.Chart,
  ViewLayout.List, ViewLayout.Gallery, ViewLayout.Feed, ViewLayout.Form, ViewLayout.Timeline];

export interface DefaultDatabaseViewIntent {
  workspaceId: string;
  databaseDoc: YDoc;
  databaseId: string;
  parentViewId: string;
  sourceViewId?: string;
  layout: DatabaseViewLayout;
  name: string;
  embedded: boolean;
  position?: CreateDefaultDatabaseViewRequest['position'];
  /** Commit Folder ownership with the view; mirror it locally before exposing the hydrated view. */
  dashboardOwner?: string;
  /** A failed numbered copy must recover its command even if realtime already delivered its name. */
  recoveryKey?: string;
  assertCurrent?: () => void;
  activate?: (viewId: string) => Promise<void>;
}

/** One immutable command, then current-authority hydration. No settings upload or compensating delete. */
export async function createDefaultDatabaseView(intent: DefaultDatabaseViewIntent): Promise<string> {
  let retired = false;
  const onDestroy = () => { retired = true; };

  intent.databaseDoc.on('destroy', onDestroy);
  try {
    return await createDefaultDatabaseViewOwned({ ...intent, assertCurrent: () => {
      if (retired) throw new Error('Database creation owner retired');
      intent.assertCurrent?.();
    } });
  } finally {
    intent.databaseDoc.off('destroy', onDestroy);
  }
}

async function createDefaultDatabaseViewOwned(intent: DefaultDatabaseViewIntent): Promise<string> {
  const { databaseDoc, databaseId, workspaceId } = intent;
  const version = databaseDoc.version;
  const restoreId = databaseDoc.databaseRestoreId ?? ORIGINAL_DATABASE_RESTORE_ID;
  const fence: { current?: Awaited<ReturnType<typeof captureDatabaseStorageFence>> } = {};
  const owner = captureAtomicCreationOwner(workspaceId, () => {
    intent.assertCurrent?.();
    if (databaseDoc.version !== version ||
      (databaseDoc.databaseRestoreId ?? ORIGINAL_DATABASE_RESTORE_ID) !== restoreId ||
      (fence.current && !isDatabaseStorageFenceCurrent(fence.current))) throw new Error('Database creation owner changed');
  });

  fence.current = await captureDatabaseStorageFence(databaseId, { required: true });
  const capturedFence = fence.current;

  owner.assertCurrent();
  const logicalTarget = intent.recoveryKey
    ? JSON.stringify([databaseId, intent.parentViewId, intent.recoveryKey])
    : JSON.stringify([databaseId, intent.parentViewId, intent.sourceViewId ?? null,
      intent.layout, intent.name, intent.embedded]);
  const pending = await findPendingAtomicCreation(owner, 'database-view', logicalTarget);

  if (pending?.state !== 'committed') assertAtomicCreationAvailable(owner);
  const request: CreateDefaultDatabaseViewRequest = pending ? parseAtomicCreationRequest(pending) : {
    schema_version: 'v1', request_id: uuidv4(), database_restore_id: restoreId,
    view: {
      database_id: databaseId, view_id: uuidv4(), parent_view_id: intent.parentViewId,
      source_view_id: intent.sourceViewId ?? null, layout: intent.layout, name: intent.name,
      embedded: intent.embedded, responses_view_id: intent.layout === DatabaseViewLayout.Form ? uuidv4() : null,
      timezone_id: [DatabaseViewLayout.Calendar, DatabaseViewLayout.Timeline].includes(intent.layout)
        ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    }, position: intent.position ?? { kind: 'end' }, icon: null,
    extra: intent.dashboardOwner ? { dashboard_owner: intent.dashboardOwner } : null,
  };

  owner.assertCurrent();
  if (request.database_restore_id !== restoreId || request.view.database_id !== databaseId ||
    request.extra?.dashboard_owner !== intent.dashboardOwner) {
    throw new Error('Pending Database creation belongs to another restore generation');
  }

  const controller = new AbortController();
  let deadline = Date.now() + 30_000;
  let timeout = setTimeout(() => controller.abort(new Error('Database creation readiness expired')), 30_000);
  let requirements: DatabaseViewSourceRequirements | undefined;
  const assertCurrent = () => { assertNotAborted(controller.signal); owner.assertCurrent(); };

  const checkRestore = async (signal = controller.signal) => {
    assertNotAborted(signal);
    const state = await atomicRead<{ database_restore_id: string | null; version: string | null }>(owner,
      `/api/workspace/${workspaceId}/database/${databaseId}/restore-state`, undefined, signal);

    assertNotAborted(signal);
    assertCurrent();
    if ((state.database_restore_id ?? ORIGINAL_DATABASE_RESTORE_ID) !== restoreId ||
      (state.version ?? undefined) !== version || !(await matchesDatabaseStorageFence(capturedFence))) {
      throw new Error('Database source restore generation changed');
    }
  };

  const read = async (signal: AbortSignal, remainingMs: number) => {
    await checkRestore(signal);
    const results = await readCollabStates(workspaceId, [{
      objectId: databaseId, collabType: Types.Database,
    }], { atomicCreationOwner: owner, signal, timeoutMs: Math.max(1, Math.min(remainingMs, deadline - Date.now())) });

    assertNotAborted(signal);
    assertCurrent();
    await checkRestore(signal);
    if (results.length !== 1) throw new Error('Database source response is ambiguous');
    return results[0];
  };

  const capture = async () => {
    assertCurrent();
    const live = Y.encodeStateAsUpdate(databaseDoc);
    const persisted = await readPersistedDatabaseSource(databaseDoc, controller.signal, capturedFence);

    assertCurrent();
    if (!(await matchesDatabaseStorageFence(capturedFence))) throw new Error('Database storage changed');
    requirements = { databaseId, restoreId, version, live, persisted };
    return requirements;
  };

  const beforeSubmit = async () => {
    await waitForDatabaseViewSource(await capture(), { read, assertCurrent, signal: controller.signal, deadline });
  };

  const hydrate = async () => {
    // The journal calls this only after validating and retaining the commit receipt.
    // Do not spend the remaining write budget on visibility reads or submit again:
    // a slow successful commit gets one separately bounded, read-only opening phase.
    assertCurrent();
    if (Date.now() >= deadline) throw new Error('Database creation readiness expired');
    clearTimeout(timeout);
    deadline = Date.now() + 10_000;
    timeout = setTimeout(() => controller.abort(new Error('Created Database view hydration expired')), 10_000);
    // A receipt's old delta is never replayed over current settings or rows.
    const captured = requirements ?? await capture();
    const ids = [request.view.view_id, ...(request.view.responses_view_id ? [request.view.responses_view_id] : [])];
    // Both reads describe the committed graph. Share their deadline, then verify
    // their identities and the restore/storage fences together before activation.
    const current = await waitForCreatedDatabaseView({
      assertCurrent, signal: controller.signal, deadline,
      read: async () => {
        // A rejected Folder read must cancel its paired source polling before retry.
        // Otherwise each retry leaves another source-read loop running until expiry.
        const attempt = new AbortController();
        const cancel = () => attempt.abort(controller.signal.reason);

        controller.signal.addEventListener('abort', cancel, { once: true });
        if (controller.signal.aborted) cancel();
        const sourceRead = waitForDatabaseViewSource(captured, { read, assertCurrent, signal: attempt.signal, deadline });
        const folderReads = ids.map((id) => atomicRead<View>(owner,
          `/api/workspace/${workspaceId}/view/${id}`, { depth: 0 }, attempt.signal));
        const remote = new Y.Doc();

        try {
          const [current, views] = await Promise.all([sourceRead, Promise.all(folderReads)]);

          Y.applyUpdate(remote, current.missingUpdate);
          const database = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
          let missing = false;

          ids.forEach((id, index) => {
            const internal = database?.get(YjsDatabaseKey.views)?.get(id);
            const folder = views[index];

            if (!internal || !folder) { missing = true; return; }

            if ((internal as Y.Map<unknown>).get(YjsDatabaseKey.id) !== id ||
              internal.get(YjsDatabaseKey.database_id) !== databaseId || folder.extra?.database_id !== databaseId || folder.view_id !== id ||
              folder.parent_view_id !== request.view.parent_view_id ||
              (index === 0 && request.extra?.dashboard_owner !== folder.extra?.dashboard_owner) ||
              folder.layout !== LAYOUTS[Number(internal.get(YjsDatabaseKey.layout))]) {
              throw new Error('Created Database view is not currently readable in Folder and content');
            }
          });
          return missing ? undefined : current;
        } catch (error) {
          attempt.abort(error);
          await Promise.allSettled([sourceRead, ...folderReads]);
          throw error;
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          attempt.abort();
          remote.destroy();
        }
      },
    });

    assertCurrent();
    await checkRestore();
    if (!remoteDatabaseCoversSource(captured, current)) throw new Error('Current Database does not cover its source');
    const published = await publishWithDatabaseStorageFence(capturedFence, () => {
      assertCurrent();
      withDatabaseStorageFence(databaseDoc, capturedFence, () => {
        applyYDoc(databaseDoc, current.missingUpdate);
        if (intent.dashboardOwner) writeCollabDashboardOwner(databaseDoc, request.view.view_id, intent.dashboardOwner);
      });
    });

    if (!published) throw new Error('Database storage changed before activation');
    assertCurrent();
    await intent.activate?.(request.view.view_id);
    assertCurrent();
    return request.view.view_id;
  };

  try {
    return pending
      ? await recoverAtomicCreation({ owner, record: pending, beforeSubmit, hydrate, signal: controller.signal })
      : await runAtomicCreation({ owner, kind: 'database-view', request, logicalTarget, beforeSubmit, hydrate, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
