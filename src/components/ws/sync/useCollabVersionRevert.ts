import EventEmitter from 'events';

import { useCallback } from 'react';
import * as Y from 'yjs';

import { openCollabDB } from '@/application/db';
import * as http from '@/application/services/js-services/http/http_api';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { User, YDoc } from '@/application/types';
import { collab } from '@/proto/messages';
import { Log } from '@/utils/log';

import { rebuildCollabDoc } from './rebuildCollabDoc';
import { SyncRefs } from './syncRefs';
import { RegisterSyncContext, SyncDocMeta } from './types';


import ICollabMessage = collab.ICollabMessage;

export function useCollabVersionRevert(
  refs: SyncRefs,
  workspaceId: string,
  currentUser: User | undefined,
  eventEmitter: EventEmitter,
  registerSyncContext: (context: RegisterSyncContext) => SyncContext,
  unregisterSyncContext: (objectId: string, options?: { flushPending?: boolean }) => void,
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void,
  applyCollabMessage: (
    message: ICollabMessage,
    options?: {
      allowVersionReset?: boolean;
      user?: User;
      isCancelled?: () => boolean;
    }
  ) => Promise<void>
) {
  const revertCollabVersion = useCallback(async (viewId: string, version: string) => {
    const context = refs.registeredContexts.current.get(viewId);

    if (currentUser && context) {
      const previousDoc = context.doc as YDoc & SyncDocMeta;
      const objectId = previousDoc.guid;
      const replayQueuedMessages = async () => {
        let queued = refs.queuedMessagesDuringReset.current.get(objectId);

        while (queued && queued.length > 0) {
          refs.queuedMessagesDuringReset.current.delete(objectId);
          for (const queuedMessage of queued) {
            await applyCollabMessage(queuedMessage, {
              allowVersionReset: true,
              user: currentUser,
            });
          }

          queued = refs.queuedMessagesDuringReset.current.get(objectId);
        }

        refs.queuedMessagesDuringReset.current.delete(objectId);
      };

      // Drop stale pending edits and pause active sync before restore/open.
      context.discardPendingUpdates?.();
      unregisterSyncContext(objectId, { flushPending: false });
      refs.resettingObjectIds.current.add(objectId);

      try {
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
        await replayQueuedMessages();
      }
    } else {
      throw new Error('Unable to restore version: sync context is unavailable. Please reopen the document and retry.');
    }
  }, [refs, workspaceId, currentUser, eventEmitter, registerSyncContext, unregisterSyncContext, scheduleDeferredCleanup, applyCollabMessage]);

  return { revertCollabVersion };
}
