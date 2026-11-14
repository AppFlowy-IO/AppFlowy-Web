import { useCallback, useSyncExternalStore } from 'react';

import { getMentionLocalSnapshot, MentionLocalSnapshot, subscribeMentionLocalIndex } from './mentionLocalIndex';

/**
 * This tab's local mention candidates for `workspaceId`, re-rendering when they change. It reads no
 * React context, so it works outside an AppProvider (published pages, tests): a workspace the app
 * has not given the index yields the empty snapshot. Pass `undefined` while the picker is closed:
 * the snapshot is then never built, and changes do not re-render.
 */
export function useMentionLocalSnapshot(workspaceId: string | undefined): MentionLocalSnapshot {
  const getSnapshot = useCallback(() => getMentionLocalSnapshot(workspaceId), [workspaceId]);

  return useSyncExternalStore(subscribeMentionLocalIndex, getSnapshot, getSnapshot);
}
