import EventEmitter from 'events';

import { type FC, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Awareness } from 'y-protocols/awareness';

import { APP_EVENTS } from '@/application/constants';
import { db } from '@/application/db';
import { CollabService, UserService } from '@/application/services/domains';
import {
  collabFullSyncBatch,
  getSlowSyncUploadTimeoutMs,
  SLOW_SYNC_PROBE_TIMEOUT_MS,
  type CollabFullSyncBatchResult,
} from '@/application/services/js-services/http/collab-api';
import { getTokenParsed } from '@/application/session/token';
import {
  clearDrainConfig,
  configureDrain,
  resumePermissionBlockedSync,
  setCurrentSession,
  type SlowSyncBlockedReason,
  type SlowSyncOutboxItem,
  startDrainAll,
} from '@/application/sync-outbox';
import type { AppEventEmitter } from '@/components/app/contexts/AppEventEmitterContext';
import { useSync, useWorkspaceRealtimeTransport } from '@/components/ws';
import { notification } from '@/proto/messages';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '../contexts/SyncInternalContext';

interface AppSyncLayerProps {
  children: ReactNode;
}

const WS_READY_STATE_OPEN = 1;

function exactSlowSyncResult(item: SlowSyncOutboxItem, results: CollabFullSyncBatchResult[]): CollabFullSyncBatchResult {
  if (results.length !== 1 || results[0].objectId !== item.objectId || results[0].collabType !== item.collabType) {
    throw new Error(`Slow-sync response did not exactly match collab ${item.objectId}`);
  }

  return results[0];
}

function blockedSlowSyncReason(error: string | undefined): SlowSyncBlockedReason | undefined {
  const normalized = error?.trim().toLowerCase();

  if (normalized?.includes('permission_denied')) return 'permission_denied';
  if (normalized?.includes('update_too_large')) return 'update_too_large';
  return undefined;
}

function hasDurableMessageId(result: CollabFullSyncBatchResult): boolean {
  return Boolean(result.messageId && Number(result.messageId.timestamp ?? 0) > 0);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;

  const error = new Error('The operation was aborted');

  error.name = 'AbortError';
  throw error;
}

function isAuthoritativeVersionChange(
  result: CollabFullSyncBatchResult,
  requestedVersion: string | null | undefined
): boolean {
  return Boolean(result.collabVersion && result.collabVersion !== requestedVersion);
}

// Second layer: WebSocket connection and synchronization
// Handles WebSocket connection, broadcast channel, sync context, and event management
// Depends on workspace ID and service from auth layer
export const AppSyncLayer: FC<AppSyncLayerProps> = ({ children }) => {
  const {
    currentWorkspaceId,
    isAuthenticated,
    maxUpdateBytes,
    maxSlowSyncUpdateBytes,
    syncLimitsLoaded = false,
  } = useAuthInternal();
  const [awarenessMap] = useState<Record<string, Awareness>>({});
  // Lazy-init so a throwaway EventEmitter isn't constructed on every render
  // (useRef keeps only the first value but still evaluates its argument each time).
  const eventEmitterRef = useRef<AppEventEmitter | null>(null);

  if (eventEmitterRef.current === null) {
    eventEmitterRef.current = new EventEmitter() as AppEventEmitter;
  }

  const eventEmitter = eventEmitterRef.current;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const globalWindow = window as typeof window & {
      Cypress?: unknown;
      __APPFLOWY_EVENT_EMITTER__?: EventEmitter;
    };

    if (globalWindow.Cypress) {
      // Expose event emitter for Cypress so tests can simulate workspace notifications
      globalWindow.__APPFLOWY_EVENT_EMITTER__ = eventEmitter;
    }
  }, [eventEmitter]);

  // The auth layer mounts this component only after selecting a workspace.
  // Transport ownership, failover, and cross-tab relaying stay encapsulated in
  // one hook so this layer only coordinates application sync concerns.
  const { webSocket, broadcastChannel, canSendToServer, sendBestEffort } = useWorkspaceRealtimeTransport({
    workspaceId: currentWorkspaceId!,
    clientId: CollabService.getClientId(),
    deviceId: CollabService.getDeviceId(),
  });

  // Initialize sync context for collaborative editing
  const {
    registerSyncContext,
    rebindSyncContext,
    flushAllSync,
    syncAllToServer,
    applyHttpFullSyncResult,
    revertCollabVersion,
    scheduleDeferredCleanup,
  } = useSync(webSocket, broadcastChannel, eventEmitter, currentWorkspaceId!);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isE2ETest = isDevelopmentOrTestEnvironment() || navigator.webdriver || 'Cypress' in window;

    if (!isE2ETest) return;

    const testWindow = window as typeof window & {
      __TEST_FLUSH_ALL_SYNC__?: () => Promise<boolean>;
    };

    testWindow.__TEST_FLUSH_ALL_SYNC__ = flushAllSync;
    return () => {
      if (testWindow.__TEST_FLUSH_ALL_SYNC__ === flushAllSync) {
        delete testWindow.__TEST_FLUSH_ALL_SYNC__;
      }
    };
  }, [flushAllSync]);

  // Handle WebSocket reconnection. Depend on the stable `reconnect` function,
  // not the webSocket container whose identity changes per incoming message.
  const webSocketReconnect = webSocket.reconnect;

  // Set up WebSocket reconnection event listener
  useEffect(() => {
    const currentEventEmitter = eventEmitter;

    currentEventEmitter.on(APP_EVENTS.RECONNECT_WEBSOCKET, webSocketReconnect);

    return () => {
      currentEventEmitter.off(APP_EVENTS.RECONNECT_WEBSOCKET, webSocketReconnect);
    };
  }, [eventEmitter, webSocketReconnect]);

  // Emit WebSocket status on actual readyState transitions only — not on every
  // webSocket identity change (which happens for each incoming message).
  const webSocketReadyState = webSocket.readyState;

  useLayoutEffect(() => {
    const currentEventEmitter = eventEmitter;

    currentEventEmitter.webSocketReadyState = webSocketReadyState;
    currentEventEmitter.emit(APP_EVENTS.WEBSOCKET_STATUS, webSocketReadyState);
  }, [eventEmitter, webSocketReadyState]);

  // Wire the persistent sync_outbox drain to the active transport owner. Fast
  // records still wait for an OPEN WebSocket, while oversized records may use
  // the HTTP slow lane during reconnects. The drain is scoped to
  // `currentWorkspaceId` so pending rows from one workspace are not
  // accidentally replayed on a different workspace's transport after switch.
  // The drain also fans out to BroadcastChannel so sibling tabs in the same
  // workspace receive local edits immediately, without waiting for a server
  // round-trip (matches the behaviour of the pre-outbox `emit` callback).
  const wsSendMessage = webSocket.sendMessage;
  const wsReadyState = webSocket.readyState;
  const bcPostDurableMessage = broadcastChannel.postDurableMessage;
  const bcPostOutboxReady = broadcastChannel.postOutboxReady;

  // Live readyState for the drain send callback. The closure capture
  // `wsReadyState` reflects the value at render time, but a drain can run
  // later — a ref ensures `isReady()` and the post-send check always see
  // the latest known state.
  const wsReadyStateRef = useRef(wsReadyState);

  useEffect(() => {
    wsReadyStateRef.current = wsReadyState;
  }, [wsReadyState]);

  // Re-derive only when auth state flips — the user id is stable for the
  // lifetime of an authenticated session, so re-parsing the token on every
  // unrelated re-render (e.g. WS status, BC message, child remount) just
  // burns a localStorage read + JSON.parse. Token-refresh still flows in
  // because `isAuthenticated` gates AppSyncLayer's mount via the auth layer.
  const currentUserId = useMemo(() => (isAuthenticated ? getTokenParsed()?.user?.id ?? null : null), [isAuthenticated]);
  const slowSync = useCallback(
    async (item: SlowSyncOutboxItem, signal: AbortSignal) => {
      if (!currentWorkspaceId) {
        throw new Error('Cannot slow-sync without an active workspace');
      }

      const request = async (docState: Uint8Array, syncLane?: 'slow') =>
        exactSlowSyncResult(
          item,
          await collabFullSyncBatch(
            currentWorkspaceId,
            [
              {
                objectId: item.objectId,
                collabType: item.collabType,
                stateVector: item.stateVector,
                docState,
                collabVersion: item.version,
              },
            ],
            {
              syncLane,
              signal,
              timeoutMs:
                syncLane === 'slow'
                  ? getSlowSyncUploadTimeoutMs(item.stateVector.byteLength + docState.byteLength)
                  : SLOW_SYNC_PROBE_TIMEOUT_MS,
            }
          )
        );
      const applyResult = async (result: CollabFullSyncBatchResult) => {
        // Axios cannot cancel a response that has already resolved. Recheck
        // the outbox lifecycle at the last possible point before enqueueing,
        // then carry the same signal through the per-object apply queue.
        throwIfAborted(signal);
        await applyHttpFullSyncResult(
          {
            objectId: result.objectId,
            collabType: result.collabType,
            missingUpdate: result.missingUpdate,
            serverStateVector: result.serverStateVector,
            collabVersion: result.collabVersion,
            messageId: result.messageId,
          },
          item.version,
          signal
        );
        throwIfAborted(signal);
      };

      // Pull server-side changes through the ordinary lightweight lane before
      // attempting the oversized upload. A state-vector match is not proof
      // that the queued update is durable: Yjs deletions do not advance state
      // vectors. Only an authoritative collab-version change can supersede it.
      const probe = await request(new Uint8Array());
      const probeBlocked = blockedSlowSyncReason(probe.error);

      if (probeBlocked) return { outcome: 'blocked' as const, reason: probeBlocked };
      if (probe.error) throw new Error(`Slow-sync probe failed for ${item.objectId}: ${probe.error}`);

      const probeSuperseded = isAuthoritativeVersionChange(probe, item.version);

      await applyResult(probe);
      if (probeSuperseded) {
        return { outcome: 'confirmed' as const, messageId: probe.messageId };
      }

      const uploaded = await request(item.docState, 'slow');
      const uploadBlocked = blockedSlowSyncReason(uploaded.error);

      if (uploadBlocked) return { outcome: 'blocked' as const, reason: uploadBlocked };
      if (uploaded.error) throw new Error(`Slow-sync upload failed for ${item.objectId}: ${uploaded.error}`);

      const uploadSuperseded = isAuthoritativeVersionChange(uploaded, item.version);

      await applyResult(uploaded);
      if (!uploadSuperseded && !hasDurableMessageId(uploaded)) {
        throw new Error(`Slow-sync response for ${item.objectId} did not include a durable message id`);
      }

      return { outcome: 'confirmed' as const, messageId: uploaded.messageId };
    },
    [applyHttpFullSyncResult, currentWorkspaceId]
  );

  // `clearDrainConfig` aborts in-flight oversized uploads, so anything in the
  // configuration effect's dep array can kill a multi-MB request mid-flight.
  // `slowSync`'s identity is derived through five useCallback hops
  // (applyHttpFullSyncResult -> enqueueIncomingCollabMessage -> ... ->
  // registerSyncContext), all stable today but not enforced by anything. Route
  // it through a latest-ref so the drain rebuilds only when ownership actually
  // changes (user, workspace, leadership, advertised limits).
  const slowSyncRef = useRef(slowSync);

  useLayoutEffect(() => {
    slowSyncRef.current = slowSync;
  }, [slowSync]);

  const stableSlowSync = useCallback(
    (item: SlowSyncOutboxItem, signal: AbortSignal) => slowSyncRef.current(item, signal),
    []
  );

  useLayoutEffect(() => {
    if (currentUserId && currentWorkspaceId) {
      setCurrentSession({ userId: currentUserId, workspaceId: currentWorkspaceId });
    } else {
      setCurrentSession(null);
    }

    return () => {
      // Unmount path (e.g., sign-out); clear so no stale session is stamped
      // onto subsequent enqueues before a new AppSyncLayer mounts.
      setCurrentSession(null);
    };
  }, [currentUserId, currentWorkspaceId]);

  useEffect(() => {
    if (!currentWorkspaceId || !currentUserId) return;

    configureDrain({
      userId: currentUserId,
      workspaceId: currentWorkspaceId,
      // Server send — gated on WS being OPEN via isReady(). `keep=false` so
      // a transient close does not silently buffer the message into
      // react-use-websocket's in-memory retry queue (which would be lost on
      // refresh). The drain catches send failures and leaves outbox records
      // in place for retry.
      send: (message) => {
        if (!canSendToServer || wsReadyStateRef.current !== WS_READY_STATE_OPEN) {
          throw new Error('[outbox] WS not OPEN at send time');
        }

        wsSendMessage(message, false);
      },
      // Sibling-tab fan-out — runs synchronously on every enqueue, regardless
      // of WS readiness, so local edits propagate across tabs even during a
      // reconnect.
      broadcast: bcPostDurableMessage,
      // Best-effort fallback when the durable IDB enqueue fails. The transport
      // buffers on the leader socket or forwards a follower update to the
      // leader over BroadcastChannel.
      sendBestEffort,
      // The conservative realtime fallback remains usable while server-info
      // loads; only the opt-in HTTP slow lane depends on advertised limits.
      isReady: () => canSendToServer && wsReadyStateRef.current === WS_READY_STATE_OPEN,
      onPersisted: bcPostOutboxReady,
      maxUpdateBytes,
      maxSlowSyncUpdateBytes,
      syncLimitsLoaded,
      // IndexedDB is shared by sibling tabs. Only the elected socket owner
      // may run the global low-concurrency HTTP lane; followers persist and
      // wake that owner through onPersisted.
      slowSync: syncLimitsLoaded && canSendToServer ? stableSlowSync : undefined,
    });

    return () => {
      clearDrainConfig();
    };
  }, [
    currentUserId,
    currentWorkspaceId,
    wsSendMessage,
    bcPostDurableMessage,
    bcPostOutboxReady,
    canSendToServer,
    sendBestEffort,
    maxUpdateBytes,
    maxSlowSyncUpdateBytes,
    syncLimitsLoaded,
    stableSlowSync,
  ]);

  // Transport readiness only wakes the already-configured drain. Keeping it
  // out of the configuration effect avoids aborting slow HTTP work and
  // resetting retry state on every CONNECTING/OPEN/CLOSED transition.
  //
  // The wake key is a dep the effect body does not read: every value in it can
  // make a previously undrainable record drainable, so the drain must be poked
  // when any of them changes. Keeping them in one named key stops
  // `react-hooks/exhaustive-deps` autofix from silently stripping them as
  // unused.
  const drainWakeKey = [
    currentUserId,
    currentWorkspaceId,
    maxUpdateBytes,
    maxSlowSyncUpdateBytes,
    syncLimitsLoaded,
    wsReadyState,
  ].join('|');

  useEffect(() => {
    if (canSendToServer) {
      startDrainAll();
    }
  }, [canSendToServer, drainWakeKey]);

  // Access changes do not rebuild the transport configuration. Wake only a
  // permission-blocked object so a restored grant can retry immediately,
  // while update-too-large blocks remain terminal until limits change.
  useEffect(() => {
    const handlePermissionChange = (permissionChange: notification.IPermissionChanged) => {
      if (permissionChange.objectId) {
        resumePermissionBlockedSync(permissionChange.objectId);
      }
    };

    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChange);

    return () => {
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChange);
    };
  }, [eventEmitter]);

  // Handle user profile change notifications
  // This provides automatic UI updates when user profile changes occur via WebSocket.
  //
  // Notification Flow:
  // 1. Server sends WorkspaceNotification with profileChange
  // 2. useSync processes notification from WebSocket OR BroadcastChannel
  // 3. useSync emits USER_PROFILE_CHANGED event via eventEmitter
  // 4. This handler receives the event and updates local database
  // 5. useLiveQuery in AppConfig detects database change
  // 6. All components using currentUser automatically re-render with new data
  //
  // Multi-tab Support:
  // - Leader tab: WebSocket → useSync → this handler → database update
  // - Other tabs: BroadcastChannel → useSync → this handler → database update
  // - Result: All tabs show updated profile simultaneously
  //
  // UI Components that auto-update:
  // - Workspace dropdown (shows email)
  // - Collaboration user lists (shows names/avatars)
  // - Any component using useCurrentUser() hook
  useEffect(() => {
    if (!isAuthenticated || !currentWorkspaceId) return;

    const currentEventEmitter = eventEmitter;

    const handleUserProfileChange = async (profileChange: notification.IUserProfileChange) => {
      try {
        // Extract user ID from authentication token
        const token = getTokenParsed();
        const userId = token?.user?.id;

        if (!userId) {
          console.warn('No user ID found for profile update');
          return;
        }

        // Retrieve current user data from local database cache
        const existingUser = await db.users.get(userId);

        if (!existingUser) {
          console.warn('No existing user found in database for profile update');
          return;
        }

        // UserProfileChange notification only contains uid, name, and email
        // It does NOT include metadata or avatar_url
        // Avatar updates come via WorkspaceMemberProfileChanged notification
        const updatedUser = {
          ...existingUser,
          name: profileChange.name ?? existingUser.name,
          email: profileChange.email ?? existingUser.email,
          // Preserve existing metadata - UserProfileChange doesn't include it
        };

        await db.users.put(updatedUser, userId);
      } catch (error) {
        console.error('Failed to handle user profile change notification:', error);
      }
    };

    const handleWorkspaceMemberProfileChange = async (profileChange: notification.IWorkspaceMemberProfileChanged) => {
      if (!currentWorkspaceId) {
        console.warn('No current workspace ID available');
        return;
      }

      const userUuid = profileChange.userUuid;

      if (!userUuid) {
        console.warn('Workspace member profile change missing user UUID');
        return;
      }

      // Name is required in the proto, but we handle it defensively
      if (!profileChange.name) {
        console.warn('Workspace member profile change missing required name field');
      }

      // Note: Field name conversion
      // - Server sends protobuf with snake_case: avatar_url, cover_image_url, etc.
      // - Protobuf JS generator automatically converts to camelCase: avatarUrl, coverImageUrl, etc.
      // - We use camelCase (avatarUrl) when reading from profileChange
      // - We use snake_case (avatar_url) when storing in database (matches schema)

      try {
        const existingProfile = await db.workspace_member_profiles
          .where('[workspace_id+user_uuid]')
          .equals([currentWorkspaceId, userUuid])
          .first();

        // If profile doesn't exist locally and this is the current user's profile,
        // try fetching it from the API first (only works for current user)
        // This can happen if the notification arrives before initial hydration
        if (!existingProfile) {
          // Check if this notification is for the current user
          const token = getTokenParsed();
          const currentUser = await db.users.get(token?.user?.id || '');
          const isCurrentUser = currentUser?.uuid === userUuid;

          if (isCurrentUser) {
            try {
              const fetchedProfile = await UserService.getWorkspaceMemberProfile(currentWorkspaceId);

              if (fetchedProfile) {
                // Use fetched profile as base, then apply notification updates
                const baseProfile = {
                  workspace_id: currentWorkspaceId,
                  user_uuid: userUuid,
                  person_id: fetchedProfile.person_id ?? userUuid,
                  uid: fetchedProfile.uid,
                  name: profileChange.name ?? fetchedProfile.name ?? '',
                  email: fetchedProfile.email ?? '',
                  role: fetchedProfile.role ?? 0,
                  avatar_url: fetchedProfile.avatar_url ?? null,
                  cover_image_url: fetchedProfile.cover_image_url ?? null,
                  custom_image_url: fetchedProfile.custom_image_url ?? null,
                  description: fetchedProfile.description ?? null,
                  invited: fetchedProfile.invited ?? false,
                  last_mentioned_at: fetchedProfile.last_mentioned_at ?? null,
                  updated_at: Date.now(),
                };

                // Apply notification updates, handling optional fields correctly
                // undefined = field not in notification (preserve existing)
                // null/empty string = field explicitly cleared
                // Note: profileChange uses camelCase (avatarUrl) from proto, we convert to snake_case (avatar_url) for database
                const updatedProfile = {
                  ...baseProfile,
                  name: profileChange.name ?? baseProfile.name,
                  avatar_url:
                    profileChange.avatarUrl !== undefined ? profileChange.avatarUrl || null : baseProfile.avatar_url,
                  cover_image_url:
                    profileChange.coverImageUrl !== undefined
                      ? profileChange.coverImageUrl || null
                      : baseProfile.cover_image_url,
                  custom_image_url:
                    profileChange.customImageUrl !== undefined
                      ? profileChange.customImageUrl || null
                      : baseProfile.custom_image_url,
                  description:
                    profileChange.description !== undefined
                      ? profileChange.description || null
                      : baseProfile.description,
                };

                await db.workspace_member_profiles.put(updatedProfile);
                return;
              }
            } catch (error) {
              console.warn('Failed to fetch workspace member profile for notification:', error);
              // Continue with creating a minimal profile from notification data
            }
          }
          // For other users' profiles, we'll create from notification data below
        }

        // Update existing profile or create new one from notification
        const updatedProfile = {
          workspace_id: currentWorkspaceId,
          user_uuid: userUuid,
          person_id: existingProfile?.person_id ?? userUuid,
          // Profile-change notifications identify users by UUID only. Keep a
          // zero sentinel until the next mentionable-user API refresh supplies
          // the numeric uid used by attribution row metadata.
          uid: existingProfile?.uid ?? 0,
          name: profileChange.name ?? existingProfile?.name ?? '',
          email: existingProfile?.email ?? '',
          role: existingProfile?.role ?? 0,
          // Handle optional fields: undefined = preserve, null/empty = clear
          // Note: profileChange uses camelCase (avatarUrl) from proto, we convert to snake_case (avatar_url) for database
          avatar_url:
            profileChange.avatarUrl !== undefined
              ? profileChange.avatarUrl || null
              : existingProfile?.avatar_url ?? null,
          cover_image_url:
            profileChange.coverImageUrl !== undefined
              ? profileChange.coverImageUrl || null
              : existingProfile?.cover_image_url ?? null,
          custom_image_url:
            profileChange.customImageUrl !== undefined
              ? profileChange.customImageUrl || null
              : existingProfile?.custom_image_url ?? null,
          description:
            profileChange.description !== undefined
              ? profileChange.description || null
              : existingProfile?.description ?? null,
          invited: existingProfile?.invited ?? false,
          last_mentioned_at: existingProfile?.last_mentioned_at ?? null,
          updated_at: Date.now(),
        };

        // Update workspace member profile in local database while preserving unspecified fields
        await db.workspace_member_profiles.put(updatedProfile);

        // Note: No need to re-emit event here. Components using useCurrentUserWorkspaceAvatar
        // will automatically re-render when the database is updated via Dexie's reactive queries.
      } catch (error) {
        console.error('Failed to handle workspace member profile change notification:', error);
      }
    };

    // Subscribe to user profile change notifications from the event system
    currentEventEmitter.on(APP_EVENTS.USER_PROFILE_CHANGED, handleUserProfileChange);
    currentEventEmitter.on(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, handleWorkspaceMemberProfileChange);

    // Cleanup subscription when component unmounts or dependencies change
    return () => {
      currentEventEmitter.off(APP_EVENTS.USER_PROFILE_CHANGED, handleUserProfileChange);
      currentEventEmitter.off(APP_EVENTS.WORKSPACE_MEMBER_PROFILE_CHANGED, handleWorkspaceMemberProfileChange);
    };
  }, [eventEmitter, isAuthenticated, currentWorkspaceId]);

  // Context value for synchronization layer. The webSocket/broadcastChannel
  // transports are intentionally excluded: their identity changes on every
  // incoming message and would re-render all consumers per message. Everything
  // exposed here is referentially stable across messages.
  const syncContextValue: SyncInternalContextType = useMemo(
    () => ({
      registerSyncContext,
      rebindSyncContext,
      revertCollabVersion,
      eventEmitter,
      awarenessMap,
      flushAllSync,
      syncAllToServer,
      scheduleDeferredCleanup,
    }),
    [
      eventEmitter,
      registerSyncContext,
      rebindSyncContext,
      revertCollabVersion,
      awarenessMap,
      flushAllSync,
      syncAllToServer,
      scheduleDeferredCleanup,
    ]
  );

  return <SyncInternalContext.Provider value={syncContextValue}>{children}</SyncInternalContext.Provider>;
};
