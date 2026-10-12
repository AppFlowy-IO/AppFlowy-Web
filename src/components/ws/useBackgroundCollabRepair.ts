import { useLayoutEffect } from 'react';

import { BackgroundRepairDonor } from '@/application/collab-repair/donor';
import { parseRepairRequest } from '@/application/collab-repair/types';
import { getCurrentOutboxSession } from '@/application/sync-outbox';

import type { AppflowyWebSocketType } from './useAppflowyWebSocket';

/** Only the socket owner reads persisted donors; follower tabs share the same IndexedDB data. */
export function useBackgroundCollabRepair(
  socket: AppflowyWebSocketType,
  canSendToServer: boolean,
  userId: string | null,
  workspaceId: string | null | undefined
): void {
  const { subscribeRepairRequests, captureRepairSender, readyState } = socket;

  useLayoutEffect(() => {
    if (!canSendToServer || readyState !== 1 || !userId || !workspaceId || !subscribeRepairRequests || !captureRepairSender) return;
    const donor = new BackgroundRepairDonor();
    let active = true;
    const unsubscribe = subscribeRepairRequests((message) => {
      const request = parseRepairRequest(message);
      const send = captureRepairSender();

      if (!request || !send) return;
      void donor.submit(request, async (update) => {
        const session = getCurrentOutboxSession(workspaceId);

        if (!active || session?.userId !== userId) return false;
        // The captured connection, exact persisted provenance and correlated ACK keep donation
        // independent from recent HTTP sync and the foreground edit outbox.
        return send(request, update);
      });
    });

    return () => {
      active = false;
      unsubscribe();
      donor.dispose();
    };
  }, [canSendToServer, readyState, userId, workspaceId, subscribeRepairRequests, captureRepairSender]);
}
