import EventEmitter from 'events';

import * as awarenessProtocol from 'y-protocols/awareness';

import { APP_EVENTS } from '@/application/constants';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, YDoc } from '@/application/types';
import { Log } from '@/utils/log';

import { CollabDocResetPayload, RegisterSyncContext, SyncDocMeta } from './types';

export type RebuildCollabDocParams = {
  previousDoc: YDoc & SyncDocMeta;
  context: SyncContext;
  eventEmitter: EventEmitter;
  registerSyncContext: (context: RegisterSyncContext) => SyncContext;
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void;
  /**
   * Called to produce the next Y.Doc. The caller supplies this to handle
   * the part that differs between version-reset and manual revert flows.
   */
  openDoc: () => Promise<YDoc & SyncDocMeta>;
  /** If true, the COLLAB_DOC_RESET event includes `isExternalRevert: true`. */
  isExternalRevert?: boolean;
  /**
   * Whether the previous doc had a pending deferred cleanup timer.
   * Must be captured by the caller BEFORE destroying the previous doc,
   * since the destroy handler clears the timer.
   */
  hadPendingDeferredCleanup: boolean;
};

/**
 * Shared doc teardown/rebuild sequence used by both the version-reset path
 * in `applyCollabMessage` and the user-initiated `revertCollabVersion`.
 *
 * This is a pure async utility (not a hook).
 */
export async function rebuildCollabDoc(params: RebuildCollabDocParams): Promise<SyncContext> {
  const {
    previousDoc,
    context,
    eventEmitter,
    registerSyncContext,
    scheduleDeferredCleanup,
    openDoc,
    isExternalRevert,
    hadPendingDeferredCleanup,
  } = params;

  const nextDoc = await openDoc();

  const nextAwareness =
    context.collabType === Types.Document ? new awarenessProtocol.Awareness(nextDoc) : undefined;

  nextDoc.object_id = previousDoc.object_id;
  nextDoc.view_id = previousDoc.view_id;
  nextDoc._collabType = previousDoc._collabType;
  nextDoc._syncBound = true;

  const newContext = registerSyncContext({
    doc: nextDoc,
    awareness: nextAwareness,
    collabType: context.collabType,
  });

  if (hadPendingDeferredCleanup) {
    scheduleDeferredCleanup(previousDoc.guid);
  }

  const resetPayload: CollabDocResetPayload = {
    objectId: previousDoc.guid,
    viewId: previousDoc.view_id ?? previousDoc.object_id,
    doc: newContext.doc,
    awareness: nextAwareness,
    isExternalRevert,
  };

  Log.debug('[Version] rebuildCollabDoc emitting COLLAB_DOC_RESET:', {
    objectId: resetPayload.objectId,
    viewId: resetPayload.viewId,
    isExternalRevert: resetPayload.isExternalRevert,
    docVersion: newContext.doc.version,
  });
  eventEmitter.emit(APP_EVENTS.COLLAB_DOC_RESET, resetPayload);

  return newContext;
}
