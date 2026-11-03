import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Editor } from 'slate';
import { Awareness } from 'y-protocols/awareness';

import { CollabService } from '@/application/services/domains';
import { getUserIconUrl } from '@/application/user-metadata';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

import { AwarenessMetadata, AwarenessState } from './types';
import { convertSlateSelectionToAwareness, generateUserColors } from './utils';

// User information parameters for awareness synchronization
export interface UserAwarenessParams {
  uid: number;
  user_uuid?: string;
  device_id: string;
  user_name: string;
  cursor_color: string;
  selection_color: string;
  user_avatar?: string;
}

type UserAwarenessIdentity = Pick<UserAwarenessParams, 'uid' | 'user_uuid' | 'device_id'>;

/**
 * Hook to dispatch user information to awareness
 * Updates user metadata without selection information
 */
export function useDispatchUserAwareness(awareness?: Awareness) {
  const dispatchUser = useCallback(
    (userParams: UserAwarenessParams) => {
      if (!awareness) return;

      const metadata: AwarenessMetadata = {
        user_name: userParams.user_name || '',
        cursor_color: userParams.cursor_color,
        selection_color: userParams.selection_color,
        user_avatar: userParams.user_avatar || '',
        user_uuid: userParams.user_uuid,
      };

      const awarenessState: AwarenessState = {
        version: 1,
        timestamp: dayjs().unix(),
        user: {
          uid: userParams.uid,
          device_id: userParams.device_id,
        },
        metadata: JSON.stringify(metadata),
      };

      awareness.setLocalState(awarenessState);

      // Log successful user awareness dispatch
      Log.debug('📡 User awareness dispatched:', awarenessState);
    },
    [awareness]
  );

  return dispatchUser;
}

/**
 * Queue cursor selection changes for the published local identity. The profile
 * publisher owns metadata, which a deferred cursor reads only when it flushes.
 */
export function useDispatchCursorAwareness(awareness?: Awareness) {
  const userIdentityRef = useRef<UserAwarenessIdentity | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const syncCursor = useCallback(() => {
    if (!awareness || !editorRef.current || !userIdentityRef.current) return;

    const editor = editorRef.current;
    const userIdentity = userIdentityRef.current;
    const current = awareness.getLocalState() as AwarenessState | null;

    if (!current?.user || !current.metadata) return;

    // Get current selection from editor
    const { selection } = editor;

    try {
      const profile = JSON.parse(current.metadata) as AwarenessMetadata;

      // A profile can refresh while this cursor waits for its debounce. Its
      // publisher owns metadata; work queued by an obsolete identity is dropped.
      if (
        current.user.uid !== userIdentity.uid ||
        current.user.device_id !== userIdentity.device_id ||
        (userIdentity.user_uuid !== undefined && profile.user_uuid !== userIdentity.user_uuid)
      ) return;
      // Convert Slate selection to AwarenessSelection
      const awarenessSelection = selection ? convertSlateSelectionToAwareness(selection, editor) : undefined;

      const awarenessState: AwarenessState = {
        ...current,
        timestamp: dayjs().unix(),
        selection: awarenessSelection,
      };

      awareness.setLocalState(awarenessState);

      // Log successful cursor awareness sync
      Log.debug('🎯 Cursor awareness synced:', awarenessState);
    } catch (error) {
      // Log conversion errors for debugging
      console.warn('⚠️ Cursor awareness sync failed:', error);
    }
  }, [awareness]);

  const debounceSyncCursor = useMemo(() => {
    return debounce(syncCursor, 100);
  }, [syncCursor]);

  useLayoutEffect(() => {
    return () => {
      debounceSyncCursor.cancel();
    };
  }, [debounceSyncCursor]);

  const dispatchCursor = useCallback(
    (userIdentity: UserAwarenessIdentity, editor?: Editor) => {
      if (!awareness || !editor) return;

      // Store references for onChange handler
      userIdentityRef.current = {
        uid: userIdentity.uid,
        user_uuid: userIdentity.user_uuid,
        device_id: userIdentity.device_id,
      };
      editorRef.current = editor;

      // Initial sync
      debounceSyncCursor();
    },
    [awareness, debounceSyncCursor]
  );

  return dispatchCursor;
}

/**
 * Hook to clear user presence from awareness
 * Removes user from awareness when leaving or disconnecting
 */
export function useDispatchClearAwareness(awareness?: Awareness) {
  const currentUser = useCurrentUser();
  const clearAwareness = useCallback(() => {
    if (!awareness) return;

    // Clear local state to remove user from awareness
    awareness.setLocalState({
      version: 1,
      timestamp: dayjs().unix(),
      user: {
        uid: Number(currentUser?.uid),
        device_id: CollabService.getDeviceId(),
      },
    });

    // Log awareness clear
    Log.debug('🚫 Awareness cleared for current user');
  }, [awareness, currentUser]);

  const clearCursor = useCallback((workspaceAvatar?: string | null) => {
    if (!awareness) return;
    const userAvatar = getUserIconUrl(currentUser, workspaceAvatar);

    awareness.setLocalState({
      version: 1,
      timestamp: dayjs().unix(),
      user: {
        uid: Number(currentUser?.uid),
        device_id: CollabService.getDeviceId(),
      },
      metadata: JSON.stringify({
        user_name: currentUser?.name || '',
        cursor_color: generateUserColors(currentUser?.name || '').cursor_color,
        selection_color: generateUserColors(currentUser?.name || '').selection_color,
        user_avatar: userAvatar,
        user_uuid: currentUser?.uuid,
      }),
    });

    Log.debug('🚫 Cursor awareness cleared for current user');
  }, [awareness, currentUser]);

  return { clearAwareness, clearCursor };
}
