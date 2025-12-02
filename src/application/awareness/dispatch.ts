import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import { useCallback, useMemo, useRef } from 'react';
import { Editor } from 'slate';
import { Awareness } from 'y-protocols/awareness';

import { getUserIconUrl } from '@/application/user-metadata';
import { Log } from '@/utils/log';
import { useCurrentUser, useService } from '@/components/main/app.hooks';

import { AwarenessMetadata, AwarenessState } from './types';
import { convertSlateSelectionToAwareness, generateUserColors } from './utils';

// User information parameters for awareness synchronization
export interface UserAwarenessParams {
  uid: number;
  device_id: string;
  user_name: string;
  cursor_color: string;
  selection_color: string;
  user_avatar?: string;
}

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
 * Hook to dispatch cursor selection to awareness
 * Updates both user metadata and current selection information
 * Automatically listens to editor changes and syncs cursor when selection changes
 */
export function useDispatchCursorAwareness(awareness?: Awareness) {
  const userParamsRef = useRef<UserAwarenessParams | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const syncCursor = useCallback(() => {
    if (!awareness || !editorRef.current || !userParamsRef.current) return;

    const editor = editorRef.current;
    const userParams = userParamsRef.current;

    // Get current selection from editor
    const { selection } = editor;

    try {
      // Convert Slate selection to AwarenessSelection
      const awarenessSelection = selection ? convertSlateSelectionToAwareness(selection, editor) : undefined;

      const metadata: AwarenessMetadata = {
        user_name: userParams.user_name,
        cursor_color: userParams.cursor_color,
        selection_color: userParams.selection_color,
        user_avatar: userParams.user_avatar || '',
      };

      const awarenessState: AwarenessState = {
        version: 1,
        timestamp: dayjs().unix(),
        user: {
          uid: userParams.uid,
          device_id: userParams.device_id,
        },
        metadata: JSON.stringify(metadata),
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

  const dispatchCursor = useCallback(
    (userParams: UserAwarenessParams, editor?: Editor) => {
      if (!awareness || !editor) return;

      // Store references for onChange handler
      userParamsRef.current = userParams;
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
  const service = useService();
  const currentUser = useCurrentUser();
  const clearAwareness = useCallback(() => {
    if (!awareness) return;

    // Clear local state to remove user from awareness
    awareness.setLocalState({
      version: 1,
      timestamp: dayjs().unix(),
      user: {
        uid: Number(currentUser?.uid),
        device_id: service?.getDeviceId() || '',
      },
    });

    // Log awareness clear
    Log.debug('🚫 Awareness cleared for current user');
  }, [awareness, service, currentUser]);

  const clearCursor = useCallback((workspaceAvatar?: string | null) => {
    if (!awareness) return;
    const userAvatar = getUserIconUrl(currentUser, workspaceAvatar);

    awareness.setLocalState({
      version: 1,
      timestamp: dayjs().unix(),
      user: {
        uid: Number(currentUser?.uid),
        device_id: service?.getDeviceId() || '',
      },
      metadata: JSON.stringify({
        user_name: currentUser?.name || '',
        cursor_color: generateUserColors(currentUser?.name || '').cursor_color,
        selection_color: generateUserColors(currentUser?.name || '').selection_color,
        user_avatar: userAvatar,
      }),
    });

    Log.debug('🚫 Cursor awareness cleared for current user');
  }, [awareness, service, currentUser]);

  return { clearAwareness, clearCursor };
}
