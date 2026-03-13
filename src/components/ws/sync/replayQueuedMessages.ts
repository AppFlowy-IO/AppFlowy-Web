import { User } from '@/application/types';
import { collab } from '@/proto/messages';

import ICollabMessage = collab.ICollabMessage;

/**
 * Drains any collab messages that were queued for `objectId` while its doc was
 * being rebuilt (version-reset or revert). Queued messages are replayed through
 * `applyCollabMessage` with `allowVersionReset: true` so the freshly-registered
 * doc receives updates that arrived during the gap.
 *
 * The function re-checks the queue after each drain pass because replaying a
 * message can itself trigger another version-reset that enqueues more messages.
 */
export async function replayQueuedMessages(
  objectId: string,
  queuedMessagesDuringReset: Map<string, ICollabMessage[]>,
  applyCollabMessage: (
    message: ICollabMessage,
    options?: { allowVersionReset?: boolean; user?: User }
  ) => Promise<void>,
  user?: User
): Promise<void> {
  let queued = queuedMessagesDuringReset.get(objectId);

  while (queued && queued.length > 0) {
    queuedMessagesDuringReset.delete(objectId);
    for (const queuedMessage of queued) {
      await applyCollabMessage(queuedMessage, {
        allowVersionReset: true,
        user,
      });
    }

    queued = queuedMessagesDuringReset.get(objectId);
  }

  queuedMessagesDuringReset.delete(objectId);
}
