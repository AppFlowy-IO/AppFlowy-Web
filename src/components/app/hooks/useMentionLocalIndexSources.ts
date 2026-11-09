import { useEffect, useRef } from 'react';

import { View } from '@/application/types';
import {
  clearMentionLocalIndex,
  MentionIndexSources,
  setMentionIndexSources,
} from '@/components/editor/components/panels/mention-panel/mentionLocalIndex';

interface GivenSources {
  workspaceId?: string;
  /** The references of the last run. */
  latest: MentionIndexSources;
  /** The previous workspace's references, as long as they are still the current ones. */
  carried: MentionIndexSources;
}

/**
 * Gives the mention picker's local index the workspace's outline, recent views and trash, as
 * references: nothing is copied until the picker reads them. An outline refresh keeps what this tab
 * recorded. The index forgets the workspace when the layer leaves it: another workspace, another
 * account, or unmount.
 *
 * After a switch, `useWorkspaceData` resets the outline and the trash in an effect, so for a commit
 * they are still the previous workspace's. The new workspace gets none of the references the
 * previous one left until they change.
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
  const givenRef = useRef<GivenSources>({ latest: {}, carried: {} });

  // Declared first, so on a switch the old workspace is cleared before the new one's sources arrive.
  useEffect(() => {
    if (!workspaceId) return;

    const ownedWorkspaceId = workspaceId;

    return () => clearMentionLocalIndex(ownedWorkspaceId);
  }, [workspaceId, requesterId]);

  // `requesterId` too: after another account's clear, the current sources are given again at once.
  useEffect(() => {
    if (!workspaceId) return;

    const given = givenRef.current;
    const latest: MentionIndexSources = { outline, recent: recentViews, trash: trashList };
    const carried = given.workspaceId === workspaceId ? given.carried : given.latest;
    // A reference that changed since the switch is this workspace's.
    const still = <T>(current: T | undefined, previous: T | undefined) => (current === previous ? previous : undefined);

    givenRef.current = {
      workspaceId,
      latest,
      carried: {
        outline: still(outline, carried.outline),
        recent: still(recentViews, carried.recent),
        trash: still(trashList, carried.trash),
      },
    };
    setMentionIndexSources(workspaceId, {
      outline: outline === carried.outline ? undefined : outline,
      recent: recentViews === carried.recent ? undefined : recentViews,
      trash: trashList === carried.trash ? undefined : trashList,
    });
  }, [workspaceId, requesterId, outline, recentViews, trashList]);
}
