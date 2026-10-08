import { useLayoutEffect } from 'react';

import { BackgroundRepairDonor } from '@/application/collab-repair/donor';
import { parseRepairRequest } from '@/application/collab-repair/types';
import { enqueueOutboxUpdate, getCurrentOutboxSession } from '@/application/sync-outbox';

import type { AppflowyWebSocketType } from './useAppflowyWebSocket';

/** Only the socket owner reads persisted donors; follower tabs share the same IndexedDB data. */
export function useBackgroundCollabRepair(
  socket: AppflowyWebSocketType,
  canSendToServer: boolean,
  userId: string | null,
  workspaceId: string | null | undefined
): void {
  const { subscribeRepairRequests, readyState } = socket;

  useLayoutEffect(() => {
    if (!canSendToServer || readyState !== 1 || !userId || !workspaceId || !subscribeRepairRequests) return;
    const donor = new BackgroundRepairDonor();
    let active = true;
    const unsubscribe = subscribeRepairRequests((message) => {
      const request = parseRepairRequest(message);

      if (!request) return;
      void donor.submit(request, async (update) => {
        const session = getCurrentOutboxSession(workspaceId);

        if (!active || session?.userId !== userId) return false;
        // The ordinary outbox preserves session ownership, restore guards, frame limits and the
        // HTTP slow lane. A repair notice never overwrites local state or binds an editor context.
        return enqueueOutboxUpdate(update, { broadcast: false });
      });
    });

    return () => {
      active = false;
      unsubscribe();
      donor.dispose();
    };
  }, [canSendToServer, readyState, userId, workspaceId, subscribeRepairRequests]);
}
