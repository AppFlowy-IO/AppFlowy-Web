import EventEmitter from 'events';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import { openCollabDB } from '@/application/db';
import { handleMessage, SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, User, YDoc } from '@/application/types';
import { collab } from '@/proto/messages';
import { Log } from '@/utils/log';

import { rebuildCollabDoc } from './rebuildCollabDoc';
import { SyncRefs } from './syncRefs';
import { isCollabVersionId, RegisterSyncContext, SyncDocMeta, UpdateCollabInfo, versionChanged } from './types';

import ICollabMessage = collab.ICollabMessage;

export function useCollabMessageHandler(
  refs: SyncRefs,
  wsCollabMessage: ICollabMessage | undefined | null,
  bcCollabMessage: ICollabMessage | undefined | null,
  eventEmitter: EventEmitter,
  registerSyncContext: (context: RegisterSyncContext) => SyncContext,
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void
) {
  const [lastUpdatedCollab, setLastUpdatedCollab] = useState<UpdateCollabInfo | null>(null);
  const lastHandledWsMessageRef = useRef<ICollabMessage | null>(null);
  const lastHandledBcMessageRef = useRef<ICollabMessage | null>(null);

  const applyCollabMessage = useCallback(
    async (
      message: ICollabMessage,
      options?: {
        allowVersionReset?: boolean;
        user?: User;
        isCancelled?: () => boolean;
      }
    ) => {
      const objectId = message.objectId!;

      const incomingVersion = message.update?.version || message.syncRequest?.version || null;
      Log.debug(`[Version] applyCollabMessage: objectId=${objectId}, incomingVersion=${JSON.stringify(incomingVersion)}, isCollabVersionId=${isCollabVersionId(incomingVersion)}`);

      if (isCollabVersionId(incomingVersion)) {
        refs.latestIncomingVersionRef.current.set(objectId, incomingVersion);
      }

      let context = refs.registeredContexts.current.get(objectId);

      if (!context && refs.resettingObjectIds.current.has(objectId)) {
        const queued = refs.queuedMessagesDuringReset.current.get(objectId) ?? [];

        queued.push(message);
        refs.queuedMessagesDuringReset.current.set(objectId, queued);
      }

      Log.debug(`[Version] context lookup: objectId=${objectId}, hasContext=${!!context}, docVersion=${JSON.stringify(context?.doc?.version)}, isCollabVersionId(docVersion)=${context ? isCollabVersionId(context.doc.version) : 'N/A'}`);

      if (context) {
        let messageHandled = false;
        const handleOnActiveContext = () => {
          const activeContext = refs.registeredContexts.current.get(objectId);

          if (!activeContext) {
            Log.debug(`[Version] handleOnActiveContext: no active context for objectId=${objectId}`);
            return false;
          }

          const activeVersion = activeContext.doc.version;
          const activeVersionKnown = isCollabVersionId(activeVersion);
          const incomingVersionKnown = isCollabVersionId(incomingVersion);

          Log.debug(`[Version] handleOnActiveContext guard: objectId=${objectId}, activeVersion=${JSON.stringify(activeVersion)}, activeVersionKnown=${activeVersionKnown}, incomingVersion=${JSON.stringify(incomingVersion)}, incomingVersionKnown=${incomingVersionKnown}, guardWillFire=${activeVersionKnown && (!incomingVersionKnown || incomingVersion !== activeVersion)}`);

          if (activeVersionKnown && (!incomingVersionKnown || incomingVersion !== activeVersion)) {
            Log.debug('Skipped collab message with mismatched version on active context', {
              objectId,
              incomingVersion,
              activeVersion,
            });
            // Consider it finalized to avoid falling through and applying stale-version updates.
            return true;
          }

          context = activeContext;
          handleMessage(activeContext, message);
          return true;
        };

        const _versionChanged = versionChanged(context, message);
        Log.debug(`[Version] versionChanged=${_versionChanged}, allowVersionReset=${options?.allowVersionReset}, objectId=${objectId}`);

        if (options?.allowVersionReset && _versionChanged) {
          if (options?.isCancelled?.()) {
            return;
          }

          const newVersion = message.update?.version || message.syncRequest?.version || undefined;
          const previousDoc = context.doc as YDoc & SyncDocMeta;
          const shouldAbortReset = () => {
            const activeContext = refs.registeredContexts.current.get(objectId);

            // Another handler already replaced the active doc for this object.
            if (activeContext && activeContext.doc !== previousDoc) {
              return true;
            }

            const latestVersion = refs.latestIncomingVersionRef.current.get(objectId);

            if (
              newVersion &&
              latestVersion &&
              isCollabVersionId(newVersion) &&
              isCollabVersionId(latestVersion) &&
              latestVersion !== newVersion
            ) {
              return true;
            }

            if (!options?.isCancelled?.()) {
              return false;
            }

            return !activeContext;
          };

          Log.debug('[Version] Collab version changed: objectId=%s, localVersion=%s, incomingVersion=%s', objectId, context.doc.version, newVersion);

          if (shouldAbortReset()) {
            Log.debug('[Version] abort reset: objectId=%s, localVersion=%s, incomingVersion=%s', objectId, context.doc.version, newVersion);
            messageHandled = handleOnActiveContext();
          } else {
            const hadPendingDeferredCleanup = refs.pendingCleanups.current.has(previousDoc.guid);
            const previousDocSnapshot = Y.encodeStateAsUpdate(previousDoc);
            const replayQueuedMessages = async () => {
              let queued = refs.queuedMessagesDuringReset.current.get(objectId);

              while (queued && queued.length > 0) {
                refs.queuedMessagesDuringReset.current.delete(objectId);
                for (const queuedMessage of queued) {
                  await applyCollabMessage(queuedMessage, {
                    allowVersionReset: true,
                    user: options?.user,
                  });
                }

                queued = refs.queuedMessagesDuringReset.current.get(objectId);
              }

              refs.queuedMessagesDuringReset.current.delete(objectId);
            };

            // Tear down the currently active doc first to stop stale edits from being
            // persisted while expectedVersion cache replacement is in progress.
            previousDoc.emit('reset', [context, newVersion]);
            context.discardPendingUpdates?.();
            refs.skipFlushOnDestroy.current.add(previousDoc.guid);
            refs.resettingObjectIds.current.add(objectId);
            previousDoc.destroy();

            try {
              const localContext = context;

              context = await rebuildCollabDoc({
                previousDoc,
                context: localContext,
                eventEmitter,
                registerSyncContext,
                scheduleDeferredCleanup,
                hadPendingDeferredCleanup,
                isExternalRevert: true,
                openDoc: async () => {
                  let nextDoc: YDoc & SyncDocMeta;

                  try {
                    const shouldForceResetCache = !isCollabVersionId(newVersion) && isCollabVersionId(previousDoc.version);
                    const openOptions: {
                      expectedVersion?: string;
                      currentUser?: string;
                      forceReset?: boolean;
                    } = {
                      currentUser: options?.user?.uid,
                    };

                    if (isCollabVersionId(newVersion)) {
                      openOptions.expectedVersion = newVersion;
                    } else if (shouldForceResetCache) {
                      openOptions.forceReset = true;
                    }

                    Log.debug('[Version] opening new doc: objectId=%s, expectedVersion=%s, forceReset=%s, previousDocVersion=%s, incomingVersion=%s', objectId, openOptions.expectedVersion, openOptions.forceReset, previousDoc.version, newVersion);
                    nextDoc = (await openCollabDB(previousDoc.guid, {
                      ...openOptions,
                    })) as YDoc & SyncDocMeta;
                    Log.debug('[Version] opened new doc: objectId=%s, nextDocVersion=%s', objectId, nextDoc.version);
                    if (!isCollabVersionId(newVersion)) {
                      // Align with desktop Option<version> semantics after mismatch reset:
                      // local doc should become version-unknown until a new authoritative version is learned.
                      nextDoc.version = undefined;
                      Log.debug('[Version] newVersion is unknown, set nextDoc.version=undefined for objectId=%s', objectId);
                    }
                  } catch (error) {
                    // Keep the page usable if cache replacement/open fails after teardown.
                    // Rehydrate a best-effort in-memory doc from the previous snapshot so
                    // sync context remains available until the next successful reset/resync.
                    Log.warn('Failed to open replacement collab doc; recovering from previous snapshot', {
                      objectId,
                      error,
                    });
                    nextDoc = new Y.Doc({
                      guid: previousDoc.guid,
                    }) as YDoc & SyncDocMeta;
                    // Keep the fallback doc on the target version so the reset-triggering
                    // message can still be applied on the new active context.
                    nextDoc.version = newVersion || previousDoc.version;
                    Y.applyUpdate(nextDoc, previousDocSnapshot);
                  }

                  return nextDoc;
                },
              });
            } finally {
              refs.resettingObjectIds.current.delete(objectId);
              await replayQueuedMessages();
            }
          }
        }

        if (!messageHandled) {
          messageHandled = handleOnActiveContext();
        }
      }

      const updateTimestamp = message.update?.messageId?.timestamp;
      const publishedAt = updateTimestamp ? new Date(updateTimestamp) : undefined;

      Log.debug('Received collab message:', message.collabType, publishedAt, message);

      if (!refs.isDisposedRef.current) {
        setLastUpdatedCollab({ objectId, publishedAt, collabType: message.collabType as Types });
      }
    },
    [refs, eventEmitter, registerSyncContext, scheduleDeferredCleanup]
  );

  const processIncomingMessageQueueForObject = useCallback(async (objectId: string) => {
    if (refs.isDisposedRef.current || refs.processingObjectIdsRef.current.has(objectId)) {
      return;
    }

    refs.processingObjectIdsRef.current.add(objectId);

    try {
      while (!refs.isDisposedRef.current) {
        const queue = refs.incomingMessageQueuesRef.current.get(objectId);

        if (!queue || queue.length === 0) {
          break;
        }

        const nextMessage = queue.shift();

        if (!nextMessage) {
          continue;
        }

        try {
          await applyCollabMessage(nextMessage, {
            allowVersionReset: true,
            user: refs.latestUserRef.current,
          });
        } catch (error) {
          Log.error('Failed to apply queued collab message', error);
        }
      }
    } finally {
      refs.processingObjectIdsRef.current.delete(objectId);
      const queue = refs.incomingMessageQueuesRef.current.get(objectId);

      if (queue && queue.length === 0) {
        refs.incomingMessageQueuesRef.current.delete(objectId);
      }

      // If new messages for this object were enqueued during the final await, keep draining.
      if (queue && queue.length > 0 && !refs.isDisposedRef.current) {
        void processIncomingMessageQueueForObject(objectId);
      }
    }
  }, [refs, applyCollabMessage]);

  const enqueueIncomingCollabMessage = useCallback(
    (message: ICollabMessage) => {
      if (refs.isDisposedRef.current) {
        return;
      }

      const objectId = message.objectId;

      if (!objectId) {
        Log.warn('Received collab message without objectId; skipped queueing', message);
        return;
      }

      const queue = refs.incomingMessageQueuesRef.current.get(objectId);

      if (queue) {
        queue.push(message);
      } else {
        refs.incomingMessageQueuesRef.current.set(objectId, [message]);
      }

      void processIncomingMessageQueueForObject(objectId);
    },
    [refs, processIncomingMessageQueueForObject]
  );

  useEffect(() => {
    const message = wsCollabMessage;

    if (!message || message === lastHandledWsMessageRef.current) {
      return;
    }

    lastHandledWsMessageRef.current = message;
    enqueueIncomingCollabMessage(message);
  }, [wsCollabMessage, enqueueIncomingCollabMessage]);

  useEffect(() => {
    const message = bcCollabMessage;

    if (!message || message === lastHandledBcMessageRef.current) {
      return;
    }

    lastHandledBcMessageRef.current = message;
    enqueueIncomingCollabMessage(message);
  }, [bcCollabMessage, enqueueIncomingCollabMessage]);

  return { lastUpdatedCollab, applyCollabMessage };
}
