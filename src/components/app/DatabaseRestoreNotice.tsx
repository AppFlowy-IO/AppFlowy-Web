import EventEmitter from 'events';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { Types, YDocWithMeta } from '@/application/types';
import { CollabDocResetPayload } from '@/components/ws/sync/types';

import { RevertedDialog } from './RevertedDialog';

type RegisterConsumer = (workspaceId: string, databaseId: string) => () => void;
const ConsumerContext = createContext<RegisterConsumer | undefined>(undefined);
const NIL_RESTORE_ID = '00000000-0000-0000-0000-000000000000';

/** Owned by the workspace, so replacing an editor cannot dismiss its restore notice. */
export function DatabaseRestoreNoticeProvider({
  workspaceId,
  eventEmitter,
  children,
}: {
  workspaceId: string;
  eventEmitter: EventEmitter;
  children: ReactNode;
}) {
  const consumers = useRef(new Map<string, number>());
  const replacing = useRef(new Map<string, string>());
  const notified = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const register = useCallback<RegisterConsumer>(
    (consumerWorkspaceId, databaseId) => {
      if (consumerWorkspaceId !== workspaceId) return () => undefined;
      consumers.current.set(databaseId, (consumers.current.get(databaseId) ?? 0) + 1);
      return () => {
        const count = (consumers.current.get(databaseId) ?? 1) - 1;

        if (count > 0) consumers.current.set(databaseId, count);
        else consumers.current.delete(databaseId);
      };
    },
    [workspaceId]
  );

  useLayoutEffect(() => {
    const handleReset = ({ objectId, doc }: CollabDocResetPayload) => {
      const restoreId = doc.databaseRestoreId;

      // Capture interest before a replaced/deleted view unmounts. Row resets and
      // initial cache hydration must not create separate user notifications.
      if (
        (doc as YDocWithMeta)._collabType === Types.Database &&
        consumers.current.has(objectId) &&
        restoreId &&
        restoreId !== NIL_RESTORE_ID
      ) {
        replacing.current.set(objectId, restoreId);
      }
    };

    const handleRestored = (event: {
      workspaceId: string;
      databaseId: string;
      restoreId: string;
      isInitialHydration?: boolean;
    }) => {
      if (event.workspaceId !== workspaceId || !event.restoreId || event.restoreId === NIL_RESTORE_ID) return;
      const { databaseId, restoreId } = event;
      const wasReplacing = replacing.current.get(databaseId) === restoreId;

      if (wasReplacing) replacing.current.delete(databaseId);
      // The editor can mount before its first authority check. Loading an
      // existing server generation does not mean this editing session reverted.
      if (event.isInitialHydration) return;
      if (!wasReplacing && !consumers.current.has(databaseId)) return;
      const key = `${databaseId}:${restoreId}`;

      if (notified.current.has(key)) return;
      notified.current.add(key);
      setPending((previous) => [...previous, key]);
    };

    eventEmitter.on(APP_EVENTS.COLLAB_DOC_RESET, handleReset);
    eventEmitter.on(APP_EVENTS.DATABASE_RESTORED, handleRestored);
    return () => {
      eventEmitter.off(APP_EVENTS.COLLAB_DOC_RESET, handleReset);
      eventEmitter.off(APP_EVENTS.DATABASE_RESTORED, handleRestored);
    };
  }, [eventEmitter, workspaceId]);

  const dismiss = useCallback(() => setPending((previous) => previous.slice(1)), []);

  return (
    <ConsumerContext.Provider value={register}>
      {children}
      <RevertedDialog kind='database' open={pending.length > 0} onDismiss={dismiss} />
    </ConsumerContext.Provider>
  );
}

/** Register an actually mounted database, independently of its sidebar/tab view IDs. */
export function useDatabaseRestoreNotice(workspaceId: string, databaseId?: string) {
  const register = useContext(ConsumerContext);

  useLayoutEffect(() => {
    if (databaseId) return register?.(workspaceId, databaseId);
  }, [register, workspaceId, databaseId]);
}
