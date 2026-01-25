import EventEmitter from 'events';

import { useCallback, useEffect, useRef, useState } from 'react';
import { validate as uuidValidate } from 'uuid';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { handleMessage, initSync, SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types } from '@/application/types';
import { AppflowyWebSocketType } from '@/components/ws/useAppflowyWebSocket';
import { BroadcastChannelType } from '@/components/ws/useBroadcastChannel';
import { messages } from '@/proto/messages';
import { Log } from '@/utils/log';

export interface RegisterSyncContext {
  /**
   * The Y.Doc instance to be used for collaboration.
   * It must have a valid guid (UUID v4).
   */
  doc: Y.Doc;
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
};

export const useSync = (ws: AppflowyWebSocketType, bc: BroadcastChannelType, eventEmitter?: EventEmitter): SyncContextType => {
  const { sendMessage, lastMessage } = ws;
  const { postMessage, lastBroadcastMessage } = bc;
  const registeredContexts = useRef<Map<string, SyncContext>>(new Map());
  const [lastUpdatedCollab, setLastUpdatedCollab] = useState<UpdateCollabInfo | null>(null);

  // Extract specific values to use as primitive dependencies
  // This prevents effect re-runs when unrelated fields of the parent object change
  const wsCollabMessage = lastMessage?.collabMessage;
  const bcCollabMessage = lastBroadcastMessage?.collabMessage;
  const wsNotification = lastMessage?.notification;
  const bcNotification = lastBroadcastMessage?.notification;

  useEffect(() => {
    if (!wsCollabMessage) return;

    const objectId = wsCollabMessage.objectId!;
    const context = registeredContexts.current.get(objectId);

    if (context) {
      handleMessage(context, wsCollabMessage);
    }

    const updateTimestamp = wsCollabMessage.update?.messageId?.timestamp;
    const publishedAt = updateTimestamp ? new Date(updateTimestamp) : undefined;

    Log.debug('Received collab message:', wsCollabMessage.collabType, publishedAt, wsCollabMessage);

    setLastUpdatedCollab({ objectId, publishedAt, collabType: wsCollabMessage.collabType as Types });
  }, [wsCollabMessage]);

  useEffect(() => {
    if (!bcCollabMessage) return;

    const objectId = bcCollabMessage.objectId!;
    const context = registeredContexts.current.get(objectId);

    if (context) {
      handleMessage(context, bcCollabMessage);
    }

    const updateTimestamp = bcCollabMessage.update?.messageId?.timestamp;
    const publishedAt = updateTimestamp ? new Date(updateTimestamp) : undefined;

    Log.debug('Received broadcasted collab message:', bcCollabMessage.collabType, publishedAt, bcCollabMessage);

    setLastUpdatedCollab({ objectId, publishedAt, collabType: bcCollabMessage.collabType as Types });
  }, [bcCollabMessage]);

  // Handle workspace notifications from WebSocket
  // This handles notifications received directly from the server via WebSocket connection.
  // Only the "active" tab per workspace maintains a WebSocket connection to prevent
  // duplicate notifications and reduce server load.
  //
  // Notification Triggers and Recipients:
  // 
  // - profileChange: When current user updates their name/email via account settings
  //   Recipients: The triggering user (SingleUser) OR all other sessions of the user (ExcludeUserAndDevice)
  //   Note: If device_id present, excludes triggering device to avoid duplicate updates
  // 
  // - permissionChanged: When object access permissions change (delete, permission denied)
  //   Recipients: ALL users in the workspace
  // 
  // - sectionChanged: When workspace sections update (recent views added/removed)
  //   Recipients: DEPENDS on action:
  //     * AddRecentViews: ALL users EXCEPT the trigger user (ExcludeSingleUser/ExcludeUserAndDevice)
  //     * RemoveRecentViews: ONLY the trigger user (SingleUser/SingleUserAndDevice)
  //   Reason: Recent views are personal to each user, so add notifications inform others while
  //           remove notifications only update the user who removed them
  // 
  // - shareViewsChanged: When view sharing settings change (guests added/removed from a view)
  //   Triggered by: share_view_with_guests() or revoke_access_to_view() in guest.rs
  //   Contains: view_id and list of affected email addresses
  //   Recipients: ALL users in the workspace
  // 
  // - mentionablePersonListChanged: When workspace members change (add/remove/role/mention)
  //   Recipients: ALL users in the workspace
  // 
  // - serverLimit: When billing or feature limits are updated
  //   Recipients: ALL users across ALL workspaces
  // 
  // - workspaceMemberProfileChanged: When ANY workspace member updates their profile
  //   (name, avatar_url, cover_image_url, custom_image_url, description) via PUT /{workspace_id}/update-member-profile
  //   Recipients: ALL users in the workspace (including the trigger user)
  useEffect(() => {
    if (!wsNotification || !eventEmitter) return;

    Log.debug('Received workspace notification:', wsNotification);

    // Emit specific notification events for each notification type
    // These events are consumed by AppProvider to update local state/database
    if (wsNotification.profileChange) {
      eventEmitter.emit(APP_EVENTS.USER_PROFILE_CHANGED, wsNotification.profileChange);
    }

    if (wsNotification.permissionChanged) {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, wsNotification.permissionChanged);
    }

    if (wsNotification.sectionChanged) {
      eventEmitter.emit(APP_EVENTS.SECTION_CHANGED, wsNotification.sectionChanged);
    }

    if (wsNotification.shareViewsChanged) {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, wsNotification.shareViewsChanged);
    }

    if (wsNotification.mentionablePersonListChanged) {
      eventEmitter.emit(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, wsNotification.mentionablePersonListChanged);
    }

    if (wsNotification.serverLimit) {
      eventEmitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED, wsNotification.serverLimit);
    }

    if (wsNotification.workspaceMemberProfileChanged) {
      eventEmitter.emit(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, wsNotification.workspaceMemberProfileChanged);
    }
  }, [wsNotification, eventEmitter]);

  // Handle workspace notifications from BroadcastChannel
  // This handles cross-tab synchronization for multi-tab scenarios. When a user has multiple
  // tabs open in the same workspace, only one tab maintains the WebSocket connection.
  // That "active" tab broadcasts notifications to other tabs via BroadcastChannel.
  // 
  // Example flow:
  // 1. User has 2 tabs open:  Document A, Document B
  // 2. Server sends notification → Document A(active WebSocket tab)
  // 3. Document A processes notification + broadcasts via BroadcastChannel
  // 4. Document B receive broadcast → process same notification
  // 5. Result: All tabs show consistent updated data simultaneously
  //
  // Without this: Only the active tab would update, other tabs would show stale data
  useEffect(() => {
    if (!bcNotification || !eventEmitter) return;

    Log.debug('Received broadcasted workspace notification:', bcNotification);

    // Process notifications identically to WebSocket notifications to ensure
    // consistent behavior across all tabs. Same event emissions = same UI updates.
    if (bcNotification.profileChange) {
      eventEmitter.emit(APP_EVENTS.USER_PROFILE_CHANGED, bcNotification.profileChange);
    }

    if (bcNotification.permissionChanged) {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, bcNotification.permissionChanged);
    }

    if (bcNotification.sectionChanged) {
      eventEmitter.emit(APP_EVENTS.SECTION_CHANGED, bcNotification.sectionChanged);
    }

    if (bcNotification.shareViewsChanged) {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, bcNotification.shareViewsChanged);
    }

    if (bcNotification.mentionablePersonListChanged) {
      eventEmitter.emit(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, bcNotification.mentionablePersonListChanged);
    }

    if (bcNotification.serverLimit) {
      eventEmitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED, bcNotification.serverLimit);
    }

    if (bcNotification.workspaceMemberProfileChanged) {
      eventEmitter.emit(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, bcNotification.workspaceMemberProfileChanged);
    }
  }, [bcNotification, eventEmitter]);

  const registerSyncContext = useCallback(
    (context: RegisterSyncContext): SyncContext => {
      if (!uuidValidate(context.doc.guid)) {
        throw new Error(`Invalid Y.Doc guid: ${context.doc.guid}. It must be a valid UUID v4.`);
      }

      const existingContext = registeredContexts.current.get(context.doc.guid);

      // If the context is already registered, return it
      if (existingContext !== undefined) {
        return existingContext;
      }

      Log.debug(`Registering sync context for objectId ${context.doc.guid} with collabType ${context.collabType}`);
      context.emit = (message) => {
        sendMessage(message);
        postMessage(message);
      };

      // SyncContext extends RegisterSyncContext by attaching the emit function and destroy handler
      const syncContext = context as SyncContext;

      registeredContexts.current.set(syncContext.doc.guid, syncContext);
      context.doc.on('destroy', () => {
        // Remove the context from the registered contexts when the Y.Doc is destroyed
        registeredContexts.current.delete(context.doc.guid);
      });

      // Initialize the sync process for the new context
      initSync(syncContext);

      return syncContext;
    },
    [registeredContexts, sendMessage, postMessage]
  );

  return { registerSyncContext, lastUpdatedCollab };
};
