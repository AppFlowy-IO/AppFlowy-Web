import { captureAtomicCreationOwner } from '@/application/atomic-creation';
import type { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  DatabaseViewLayout,
  LoadView,
  YDoc,
} from '@/application/types';
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
  /** Witness an already attached receipt so a later insertion cannot attach it a second time. */
  findExistingActivation?: (viewId: string) => (() => void) | undefined;
  assertCurrent?: () => void;
}

/** Borrow the existing source sync owner; normal sync, not an explicit upload, satisfies readiness. */
export async function createLinkedDefaultDatabaseView(
  intent: LinkedDefaultViewIntent
): Promise<CreateDatabaseViewResponse> {
  const owner = captureAtomicCreationOwner(intent.workspaceId, intent.assertCurrent);

  if (!intent.loadView || !intent.bindViewSync || !intent.scheduleDeferredCleanup) {
    throw new Error('Linked Database creation is not available');
  }

  let source: YDoc | undefined;

  try {
    source = await intent.loadView(intent.sourceViewId, false, false, {
      databaseId: intent.payload.database_id,
      forceFetch: true,
    });
    owner.assertCurrent();
    if (!intent.bindViewSync(source)) throw new Error('The source Database has no live sync owner');
    const databaseDoc = source;
    const create = async (allowCompletedRecovery: boolean) => {
      let existingActivation: (() => void) | undefined;
      const viewId = await createDefaultDatabaseView({
        workspaceId: intent.workspaceId,
        databaseDoc,
        databaseId: intent.payload.database_id,
        parentViewId: intent.payload.parent_view_id ?? intent.requestViewId,
        sourceViewId: intent.sourceViewId,
        layout: intent.layout,
        name: intent.payload.name ?? '',
        embedded: intent.payload.embedded ?? true,
        activate: async (id) => {
          owner.assertCurrent();
          existingActivation = intent.findExistingActivation?.(id);
          if (existingActivation) {
            if (!allowCompletedRecovery) throw new Error('Linked Database recovery changed during creation');
            existingActivation();
            return;
          }

          await intent.activate(id);
        },
        assertCurrent: () => {
          owner.assertCurrent();
          existingActivation?.();
        },
      });

      return { viewId, recovered: Boolean(existingActivation) };
    };

    let created = await create(true);

    // A previous client may have attached the block but failed its final
    // ownership check. Finish that receipt through normal current hydration
    // first; this new insertion then receives exactly one fresh command.
    if (created.recovered) created = await create(false);
    owner.assertCurrent();
    return { view_id: created.viewId, database_id: intent.payload.database_id };
  } finally {
    if (source) {
      try {
        intent.scheduleDeferredCleanup(source.guid);
      } catch (error) {
        Log.warn('[Atomic linked view] failed to release source owner', error);
      }
    }
  }
}
