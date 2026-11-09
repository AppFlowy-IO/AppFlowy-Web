import { useEffect } from 'react';

import { View } from '@/application/types';
import {
  clearMentionLocalIndex,
  setMentionIndexSources,
} from '@/components/editor/components/panels/mention-panel/mentionLocalIndex';

/**
 * Gives the mention picker's local index the workspace's outline, recent views and trash, as
 * references: nothing is copied until the picker reads them. An outline refresh keeps what this tab
 * recorded. The index forgets the workspace when the layer leaves it: another workspace, another
 * account, or unmount.
 */
export function useMentionLocalIndexSources({
  workspaceId,
  requesterId,
  outline,
  recentViews,
  trashList,
}: {
  workspaceId?: string;
  requesterId?: string;
  outline?: View[];
  recentViews?: View[];
  trashList?: View[];
}) {
  // Declared first, so on a switch the old workspace is cleared before the new one's sources arrive.
  useEffect(() => {
    if (!workspaceId) return;

    const ownedWorkspaceId = workspaceId;

    return () => clearMentionLocalIndex(ownedWorkspaceId);
  }, [workspaceId, requesterId]);

  // `requesterId` too: after another account's clear, the current sources are given again at once.
  useEffect(() => {
    if (!workspaceId) return;

    setMentionIndexSources(workspaceId, { outline, recent: recentViews, trash: trashList });
  }, [workspaceId, requesterId, outline, recentViews, trashList]);
}
