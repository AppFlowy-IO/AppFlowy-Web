import { captureAtomicCreationOwner } from '@/application/atomic-creation';
import type { SyncContext } from '@/application/services/js-services/sync-protocol';
import { CreateDatabaseViewPayload, CreateDatabaseViewResponse, DatabaseViewLayout, LoadView, YDoc } from '@/application/types';
import { Log } from '@/utils/log';

import { createDefaultDatabaseView } from './create-default-view';

export interface LinkedDefaultViewIntent {
  workspaceId: string;
  requestViewId: string;
  sourceViewId: string;
  payload: Omit<CreateDatabaseViewPayload, 'layout'>;
  layout: DatabaseViewLayout;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
  activate: (viewId: string) => Promise<void>;
  assertCurrent?: () => void;
}

/** Borrow the existing source sync owner; normal sync, not an explicit upload, satisfies readiness. */
export async function createLinkedDefaultDatabaseView(intent: LinkedDefaultViewIntent): Promise<CreateDatabaseViewResponse> {
  const owner = captureAtomicCreationOwner(intent.workspaceId, intent.assertCurrent);

  if (!intent.loadView || !intent.bindViewSync || !intent.scheduleDeferredCleanup) {
    throw new Error('Linked Database creation is not available');
  }

  let source: YDoc | undefined;

  try {
    source = await intent.loadView(intent.sourceViewId, false, false, {
      databaseId: intent.payload.database_id, forceFetch: true,
    });
    owner.assertCurrent();
    if (!intent.bindViewSync(source)) throw new Error('The source Database has no live sync owner');
    const viewId = await createDefaultDatabaseView({
      workspaceId: intent.workspaceId, databaseDoc: source, databaseId: intent.payload.database_id,
      parentViewId: intent.payload.parent_view_id ?? intent.requestViewId,
      sourceViewId: intent.sourceViewId, layout: intent.layout, name: intent.payload.name ?? '',
      embedded: intent.payload.embedded ?? true, activate: intent.activate,
      assertCurrent: () => owner.assertCurrent(),
    });

    owner.assertCurrent();
    return { view_id: viewId, database_id: intent.payload.database_id };
  } finally {
    if (source) {
      try { intent.scheduleDeferredCleanup(source.guid); }
      catch (error) { Log.warn('[Atomic linked view] failed to release source owner', error); }
    }
  }
}
