import EventEmitter from 'events';

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';

import { deleteCollabDB, openCollabDB, openRowCollabDBWithProvider } from '@/application/db';
import { cacheCanonicalRowDoc } from '@/application/services/js-services/cache';
import { handleMessage, SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, YDoc } from '@/application/types';
import { collab } from '@/proto/messages';
import { Log } from '@/utils/log';

import { rebuildCollabDoc } from './rebuildCollabDoc';
import { replayQueuedMessages } from './replayQueuedMessages';
import { SyncRefs } from './syncRefs';
import {
  ApplyCollabMessageOptions,
  isCollabVersionId,
  QueuedCollabMessage,
  RegisterSyncContext,
  SyncDocMeta,
  versionChanged,
} from './types';

import ICollabMessage = collab.ICollabMessage;

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;

  const error = new Error('The operation was aborted');

  error.name = 'AbortError';
  return error;
}

function isApplyCancelled(options?: ApplyCollabMessageOptions): boolean {
  return Boolean(options?.signal?.aborted || options?.isCancelled?.());
}

export function useCollabMessageHandler(
  refs: SyncRefs,
  wsCollabMessage: ICollabMessage | undefined | null,
  bcCollabMessage: ICollabMessage | undefined | null,
  eventEmitter: EventEmitter,
  registerSyncContext: (context: RegisterSyncContext) => SyncContext,
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void
) {
  const lastHandledWsMessageRef = useRef<ICollabMessage | null>(null);
  const lastHandledBcMessageRef = useRef<ICollabMessage | null>(null);

  const applyCollabMessage = useCallback(
    async (message: ICollabMessage, options?: ApplyCollabMessageOptions) => {
      const objectId = message.objectId!;

      if (isApplyCancelled(options)) {
        return false;
      }

      const incomingVersion = message.update?.version || message.syncRequest?.version || null;

      Log.debug(
        `[Version] applyCollabMessage: objectId=${objectId}, incomingVersion=${JSON.stringify(
          incomingVersion
        )}, isCollabVersionId=${isCollabVersionId(incomingVersion)}`
      );

      if (isCollabVersionId(incomingVersion)) {
        refs.latestIncomingVersionRef.current.set(objectId, incomingVersion);
      }

      let context = refs.registeredContexts.current.get(objectId);

      // While a reset is in progress for this objectId, queue incoming
      // messages for later replay. This covers both the "context already
      // unregistered" path and the narrow window where the reset has been
      // flagged but the context hasn't been torn down yet (e.g. while an
      // `await discardPendingUpdates` is pending).
      if (refs.resettingObjectIds.current.has(objectId)) {
        const queued = refs.queuedMessagesDuringReset.current.get(objectId) ?? [];

        queued.push(message);
        refs.queuedMessagesDuringReset.current.set(objectId, queued);
        return false;
      }

      Log.debug(
        `[Version] context lookup: objectId=${objectId}, hasContext=${!!context}, docVersion=${JSON.stringify(
          context?.doc?.version
        )}, isCollabVersionId(docVersion)=${context ? isCollabVersionId(context.doc.version) : 'N/A'}`
      );

      let messageHandled = false;

      if (context) {
        const handleOnActiveContext = () => {
          if (isApplyCancelled(options)) {
            return false;
          }

          const activeContext = refs.registeredContexts.current.get(objectId);

          if (!activeContext) {
            Log.debug(`[Version] handleOnActiveContext: no active context for objectId=${objectId}`);
            return false;
          }

          const activeVersion = activeContext.doc.version;
          const activeVersionKnown = isCollabVersionId(activeVersion);
          const incomingVersionKnown = isCollabVersionId(incomingVersion);

          Log.debug(
            `[Version] handleOnActiveContext guard: objectId=${objectId}, activeVersion=${JSON.stringify(
              activeVersion
            )}, activeVersionKnown=${activeVersionKnown}, incomingVersion=${JSON.stringify(
              incomingVersion
            )}, incomingVersionKnown=${incomingVersionKnown}, guardWillFire=${
              activeVersionKnown && (!incomingVersionKnown || incomingVersion !== activeVersion)
            }`
          );

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

        Log.debug(
          `[Version] versionChanged=${_versionChanged}, allowVersionReset=${options?.allowVersionReset}, objectId=${objectId}`
        );

        if (options?.allowVersionReset && _versionChanged) {
          if (isApplyCancelled(options)) {
            return false;
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

            if (!isApplyCancelled(options)) {
              return false;
            }

            return !activeContext;
          };

          Log.debug(
            '[Version] Collab version changed: objectId=%s, localVersion=%s, incomingVersion=%s',
            objectId,
            context.doc.version,
            newVersion
          );

          if (shouldAbortReset()) {
            Log.debug(
              '[Version] abort reset: objectId=%s, localVersion=%s, incomingVersion=%s',
              objectId,
              context.doc.version,
              newVersion
            );
            messageHandled = handleOnActiveContext();
          } else {
            const hadPendingDeferredCleanup = refs.pendingCleanups.current.has(previousDoc.guid);
            const ownerCount = Math.max(1, refs.contextRefCounts.current.get(objectId) ?? 0);
            const previousDocSnapshot = Y.encodeStateAsUpdate(previousDoc);

            // Tear down the currently active doc first to stop stale edits from being
            // persisted while expectedVersion cache replacement is in progress.
            // Await the outbox deletion so the drain cannot race ahead and send
            // pre-reset rows onto the newly-rebuilt doc.
            previousDoc.emit('reset', [context, newVersion]);
            refs.skipFlushOnDestroy.current.add(previousDoc.guid);
            refs.resettingObjectIds.current.add(objectId);

            try {
              // Discard and destroy live inside the try so a rejection
              // (e.g. IDB blocked/closing) still runs the finally that
              // clears `resettingObjectIds`. Without this, a failed discard
              // would leave the object permanently flagged as resetting —
              // `applyCollabMessage` would queue every subsequent message
              // and the doc would stay stuck until reload.
              await context.discardPendingUpdates?.({
                skipActiveDrain: options?.skipActiveDrainOnDiscard,
              });
              await deleteCollabDB(previousDoc.guid, { destroyDoc: false });
              previousDoc.destroy();

              const localContext = context;

              context = await rebuildCollabDoc({
                previousDoc,
                context: localContext,
                eventEmitter,
                registerSyncContext,
                scheduleDeferredCleanup,
                hadPendingDeferredCleanup,
                ownerCount,
                isExternalRevert: true,
                openDoc: async () => {
                  let nextDoc: YDoc & SyncDocMeta;

                  try {
                    const shouldForceResetCache =
                      !isCollabVersionId(newVersion) && isCollabVersionId(previousDoc.version);
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

                    Log.debug(
                      '[Version] opening new doc: objectId=%s, expectedVersion=%s, forceReset=%s, previousDocVersion=%s, incomingVersion=%s',
                      objectId,
                      openOptions.expectedVersion,
                      openOptions.forceReset,
                      previousDoc.version,
                      newVersion
                    );
                    if (localContext.collabType === Types.DatabaseRow) {
                      const rowEntry = await openRowCollabDBWithProvider(previousDoc.guid, openOptions);

                      nextDoc = rowEntry.doc as YDoc & SyncDocMeta;
                    } else {
                      nextDoc = (await openCollabDB(previousDoc.guid, {
                        ...openOptions,
                      })) as YDoc & SyncDocMeta;
                    }

                    Log.debug('[Version] opened new doc: objectId=%s, nextDocVersion=%s', objectId, nextDoc.version);
                    if (!isCollabVersionId(newVersion)) {
                      // Align with desktop Option<version> semantics after mismatch reset:
                      // local doc should become version-unknown until a new authoritative version is learned.
                      nextDoc.version = undefined;
                      Log.debug(
                        '[Version] newVersion is unknown, set nextDoc.version=undefined for objectId=%s',
                        objectId
                      );
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

              if (localContext.collabType === Types.DatabaseRow) {
                cacheCanonicalRowDoc(objectId, context.doc);
              }
            } finally {
              // If discard threw before destroy fired, the doc.on('destroy')
              // handler never consumed this flag — clean it up defensively so
              // a later unrelated destroy doesn't accidentally suppress flush.
              refs.skipFlushOnDestroy.current.delete(previousDoc.guid);
              refs.resettingObjectIds.current.delete(objectId);
              await replayQueuedMessages(
                objectId,
                refs.queuedMessagesDuringReset.current,
                applyCollabMessage,
                options?.user
              );
            }
          }
        }

        if (!messageHandled) {
          messageHandled = handleOnActiveContext();
        }
      }

      Log.debug('Received collab message:', message.collabType, message);
      return options?.requireActiveContext ? messageHandled : true;
    },
    [refs, eventEmitter, registerSyncContext, scheduleDeferredCleanup]
  );

  const processIncomingMessageQueueForObject = useCallback(
    async (objectId: string) => {
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

          const nextTask = queue.shift();

          if (!nextTask) {
            continue;
          }

          try {
            const signal = nextTask.options?.signal;

            if (isApplyCancelled(nextTask.options)) {
              if (signal?.aborted) {
                nextTask.reject?.(abortReason(signal));
              } else {
                nextTask.resolve?.(false);
              }

              continue;
            }

            const applied = await applyCollabMessage(nextTask.message, {
              allowVersionReset: true,
              user: refs.latestUserRef.current,
              ...nextTask.options,
            });

            if (signal?.aborted) {
              nextTask.reject?.(abortReason(signal));
            } else {
              nextTask.resolve?.(applied);
            }
          } catch (error) {
            const signal = nextTask.options?.signal;

            if (signal?.aborted) {
              nextTask.reject?.(abortReason(signal));
            } else {
              Log.error('Failed to apply queued collab message', error);
              nextTask.reject?.(error);
            }
          } finally {
            nextTask.dispose?.();
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
    },
    [refs, applyCollabMessage]
  );

  const enqueueIncomingCollabMessage = useCallback(
    (message: ICollabMessage, options?: ApplyCollabMessageOptions): Promise<boolean> => {
      if (refs.isDisposedRef.current) {
        return Promise.reject(new Error('Cannot enqueue collab message after sync disposal'));
      }

      const objectId = message.objectId;

      if (!objectId) {
        Log.warn('Received collab message without objectId; skipped queueing', message);
        return Promise.reject(new Error('Cannot enqueue collab message without objectId'));
      }

      const signal = options?.signal;

      if (signal?.aborted) {
        return Promise.reject(abortReason(signal));
      }

      const queuedObjectId = objectId;

      return new Promise<boolean>((resolve, reject) => {
        function dispose() {
          signal?.removeEventListener('abort', handleAbort);
        }

        function handleAbort() {
          if (!signal) return;

          const queue = refs.incomingMessageQueuesRef.current.get(queuedObjectId);
          const queuedIndex = queue?.indexOf(task) ?? -1;

          // A task that has already been shifted is allowed to finish its
          // structural reset safely; applyCollabMessage checks cancellation
          // again before touching the active context. A task still waiting
          // behind another reset can be removed immediately, breaking the
          // reset -> drain -> queued-result wait cycle.
          if (!queue || queuedIndex < 0) return;

          queue.splice(queuedIndex, 1);
          if (queue.length === 0) {
            refs.incomingMessageQueuesRef.current.delete(queuedObjectId);
          }

          dispose();
          reject(abortReason(signal));
        }

        const task: QueuedCollabMessage = { message, options, resolve, reject, dispose };

        signal?.addEventListener('abort', handleAbort, { once: true });

        // Close the narrow race between the initial check and listener setup.
        if (signal?.aborted) {
          dispose();
          reject(abortReason(signal));
          return;
        }

        const queue = refs.incomingMessageQueuesRef.current.get(queuedObjectId);

        if (queue) {
          queue.push(task);
        } else {
          refs.incomingMessageQueuesRef.current.set(queuedObjectId, [task]);
        }

        void processIncomingMessageQueueForObject(queuedObjectId);
      });
    },
    [refs, processIncomingMessageQueueForObject]
  );

  useEffect(() => {
    const message = wsCollabMessage;

    if (!message || message === lastHandledWsMessageRef.current) {
      return;
    }

    lastHandledWsMessageRef.current = message;
    void enqueueIncomingCollabMessage(message).catch((error) => {
      Log.error('Failed to enqueue WebSocket collab message', error);
    });
  }, [wsCollabMessage, enqueueIncomingCollabMessage]);

  useEffect(() => {
    const message = bcCollabMessage;

    if (!message || message === lastHandledBcMessageRef.current) {
      return;
    }

    lastHandledBcMessageRef.current = message;
    void enqueueIncomingCollabMessage(message).catch((error) => {
      Log.error('Failed to enqueue BroadcastChannel collab message', error);
    });
  }, [bcCollabMessage, enqueueIncomingCollabMessage]);

  return { applyCollabMessage, enqueueIncomingCollabMessage };
}
