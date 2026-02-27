import * as awarenessProtocol from 'y-protocols/awareness';
import { validate as uuidValidate } from 'uuid';

import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, YDoc } from '@/application/types';
import { collab, messages } from '@/proto/messages';

export type SyncDocMeta = {
  object_id?: string;
  view_id?: string;
  _collabType?: Types;
  _syncBound?: boolean;
};

export type CollabDocResetPayload = {
  objectId: string;
  viewId?: string;
  doc: YDoc;
  awareness?: awarenessProtocol.Awareness;
  /** True when the reset was pushed by the server (another device reverted). */
  isExternalRevert?: boolean;
};

export interface RegisterSyncContext {
  /**
   * The Y.Doc instance to be used for collaboration.
   * It must have a valid guid (UUID v4).
   */
  doc: YDoc;
  awareness?: awarenessProtocol.Awareness;
  collabType: Types;
  emit?: (reply: messages.IMessage) => void;
}

export type UpdateCollabInfo = {
  /**
   * The objectId of the Y.Doc instance.
   * It must be a valid UUID v4.
   */
  objectId: string;
  collabType: Types;
  /**
   * The timestamp when the corresponding update has been known to the server.
   */
  publishedAt?: Date;
};

export type SyncContextType = {
  registerSyncContext: (context: RegisterSyncContext) => SyncContext;
  lastUpdatedCollab: UpdateCollabInfo | null;
  /**
   * Flush all pending updates for all registered sync contexts.
   * This ensures all local changes are sent to the server via WebSocket.
   */
  flushAllSync: () => void;
  /**
   * Sync all registered collab documents to the server via HTTP API.
   * This is similar to desktop's collab_full_sync_batch - it sends the full doc state
   * to ensure the server has the latest data before operations like duplicate.
   *
   * @param workspaceId - The workspace ID
   * @returns Promise that resolves when all syncs are complete
   */
  syncAllToServer: (workspaceId: string) => Promise<void>;
  /**
   * Schedule deferred cleanup of a sync context after a delay.
   * If the same objectId is re-registered before the timer fires,
   * the cleanup is cancelled and the existing context is reused.
   *
   * @param objectId - The Y.Doc guid to schedule cleanup for
   * @param delayMs - Delay in milliseconds (default: 10_000)
   */
  scheduleDeferredCleanup: (objectId: string, delayMs?: number) => void;
  revertCollabVersion: (viewId: string, versionId: string) => Promise<void>;
};

export const isCollabVersionId = (value: string | null | undefined): value is string => {
  return typeof value === 'string' && uuidValidate(value);
};

export const versionChanged = (context: SyncContext, message: collab.ICollabMessage): boolean => {
  const incomingVersion = message.update?.version || message.syncRequest?.version || null;
  const localVersion = context.doc.version;
  const incomingKnown = isCollabVersionId(incomingVersion);
  const localKnown = isCollabVersionId(localVersion);

  // Both unknown — no conflict, apply the update normally.
  if (!incomingKnown && !localKnown) {
    return false;
  }

  // Server has a known version but local doesn't → reset to adopt the server's version.
  if (!localKnown) {
    return true;
  }

  // Local has a known version but incoming doesn't → the server lost/cleared its
  // version (e.g. cache eviction). Reset so local state re-syncs from scratch.
  if (!incomingKnown) {
    return true;
  }

  return incomingVersion !== localVersion;
};
