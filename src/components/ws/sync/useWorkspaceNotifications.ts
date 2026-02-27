import EventEmitter from 'events';

import { useEffect } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { notification } from '@/proto/messages';
import { Log } from '@/utils/log';

type WorkspaceNotification = notification.IWorkspaceNotification;

function dispatchNotifications(
  eventEmitter: EventEmitter,
  n: WorkspaceNotification
) {
  if (n.profileChange) {
    eventEmitter.emit(APP_EVENTS.USER_PROFILE_CHANGED, n.profileChange);
  }

  if (n.permissionChanged) {
    eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, n.permissionChanged);
  }

  if (n.sectionChanged) {
    eventEmitter.emit(APP_EVENTS.SECTION_CHANGED, n.sectionChanged);
  }

  if (n.shareViewsChanged) {
    eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, n.shareViewsChanged);
  }

  if (n.mentionablePersonListChanged) {
    eventEmitter.emit(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, n.mentionablePersonListChanged);
  }

  if (n.serverLimit) {
    eventEmitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED, n.serverLimit);
  }

  if (n.workspaceMemberProfileChanged) {
    eventEmitter.emit(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, n.workspaceMemberProfileChanged);
  }

  if (n.folderChanged) {
    eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, n.folderChanged);
  }

  if (n.folderViewChanged) {
    eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, n.folderViewChanged);
  }
}

export function useWorkspaceNotifications(
  wsNotification: WorkspaceNotification | undefined | null,
  bcNotification: WorkspaceNotification | undefined | null,
  eventEmitter: EventEmitter
) {
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
    if (!wsNotification) return;

    Log.debug('Received workspace notification:', wsNotification);
    dispatchNotifications(eventEmitter, wsNotification);
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
    if (!bcNotification) return;

    Log.debug('Received broadcasted workspace notification:', bcNotification);
    dispatchNotifications(eventEmitter, bcNotification);
  }, [bcNotification, eventEmitter]);
}
