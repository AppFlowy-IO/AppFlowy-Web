import EventEmitter from 'events';

import { useCallback } from 'react';
import * as Y from 'yjs';

import { deleteCollabDB, openCollabDB } from '@/application/db';
import * as http from '@/application/services/js-services/http/http_api';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { User, YDoc } from '@/application/types';
import { collab } from '@/proto/messages';
import { Log } from '@/utils/log';

import { prepareDatabaseRowsForVersionReset } from './databaseVersionReset';
import { rebuildCollabDoc } from './rebuildCollabDoc';
import { replayQueuedMessages } from './replayQueuedMessages';
import { SyncRefs } from './syncRefs';
import { RegisterSyncContext, SyncDocMeta } from './types';

import ICollabMessage = collab.ICollabMessage;

export type CollabVersionRevertDeps = {
  refs: SyncRefs;
  workspaceId: string;
  eventEmitter: EventEmitter;
  registerSyncContext: (context: RegisterSyncContext) => SyncContext;
  unregisterSyncContext: (objectId: string, options?: { flushPending?: boolean }) => void;
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void;
  applyCollabMessage: (
    message: ICollabMessage,
    options?: {
      allowVersionReset?: boolean;
      user?: User;
      isCancelled?: () => boolean;
    }
  ) => Promise<void>;
};

export function useCollabVersionRevert(deps: CollabVersionRevertDeps) {
  const {
    refs,
    workspaceId,
    eventEmitter,
    registerSyncContext,
    unregisterSyncContext,
    scheduleDeferredCleanup,
    applyCollabMessage,
  } = deps;

  const revertCollabVersion = useCallback(
    async (viewId: string, version: string) => {
      const context = refs.registeredContexts.current.get(viewId);
      const currentUser = refs.latestUserRef.current;

      if (currentUser && context) {
        const previousDoc = context.doc as YDoc & SyncDocMeta;
        const objectId = previousDoc.guid;

        // Drop stale pending edits and pause active sync before restore/open.
        // Mark the objectId as "resetting" *before* awaiting so that any
        // concurrent incoming message handler observes the guard and queues
        // instead of applying. Keep the discard/unregister inside the outer
        // try so a failing IDB delete still runs the `finally` that clears
        // `resettingObjectIds` (otherwise remote messages would queue forever).
        refs.resettingObjectIds.current.add(objectId);

        try {
          await context.discardPendingUpdates?.();
          unregisterSyncContext(objectId, { flushPending: false });

          const { docState, version: serverVersion } = await http.revertCollabVersion(
            workspaceId,
            viewId,
            context.collabType,
            version
          );
          const nextVersion = serverVersion || version;

          Log.debug('[Version] Collab version changed:', viewId, previousDoc.version, nextVersion);
          previousDoc.emit('reset', [context, nextVersion]);
          refs.skipFlushOnDestroy.current.add(previousDoc.guid);
          const rowIdsPendingReset = new Set<string>();

          try {
            try {
              await prepareDatabaseRowsForVersionReset(context, previousDoc, {
                beforeResetRow: async (rowId) => {
                  // Only mark rows with an active sync context — see same guard in
                  // useCollabMessageHandler.ts.
                  const rowContext = refs.registeredContexts.current.get(rowId);

                  if (!rowContext) return;

                  rowIdsPendingReset.add(rowId);
                  refs.skipFlushOnDestroy.current.add(rowId);
                  await rowContext.discardPendingUpdates?.();
                },
              });
            } catch (error) {
              // Row prep ran after we unregistered the database context but
              // before deleteCollabDB/destroy. Re-register the previous doc so
              // the page stays synced; otherwise the user is left without a
              // working sync context until reload.
              refs.skipFlushOnDestroy.current.delete(previousDoc.guid);
              registerSyncContext({
                doc: previousDoc,
                awareness: context.awareness,
                collabType: context.collabType,
              });
              throw error;
            }
          } finally {
            rowIdsPendingReset.forEach((rowId) => {
              refs.skipFlushOnDestroy.current.delete(rowId);
            });
          }

          await deleteCollabDB(previousDoc.guid, { destroyDoc: false });
          previousDoc.destroy();

          try {
            await rebuildCollabDoc({
              previousDoc,
              context,
              eventEmitter,
              registerSyncContext,
              scheduleDeferredCleanup,
              hadPendingDeferredCleanup: false,
              openDoc: async () => {
                let doc: (YDoc & SyncDocMeta) | null = null;

                try {
                  doc = (await openCollabDB(previousDoc.guid, {
                    expectedVersion: nextVersion,
                    currentUser: currentUser.uid,
                  })) as YDoc & SyncDocMeta;
                  Y.applyUpdate(doc, docState);
                } catch (error) {
                  doc?.destroy();
                  throw error;
                }

                return doc;
              },
            });
          } catch (error) {
            // Restore previous context if version restore fails.
            registerSyncContext({
              doc: previousDoc,
              awareness: context.awareness,
              collabType: context.collabType,
            });
            throw error;
          }
        } finally {
          refs.resettingObjectIds.current.delete(objectId);
          await replayQueuedMessages(objectId, refs.queuedMessagesDuringReset.current, applyCollabMessage, currentUser);
        }
      } else {
        throw new Error('Unable to restore version: sync context is unavailable. Please reopen the document and retry.');
      }
    },
    [
      refs,
      workspaceId,
      eventEmitter,
      registerSyncContext,
      unregisterSyncContext,
      scheduleDeferredCleanup,
      applyCollabMessage,
    ]
  );

  return { revertCollabVersion };
}
