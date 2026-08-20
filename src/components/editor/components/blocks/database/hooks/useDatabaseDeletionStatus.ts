
import { useEffect, useRef, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { ViewService } from '@/application/services/domains';
import type { View } from '@/application/types';

import { isViewGoneError } from '../utils/databaseBlockUtils';

import type EventEmitter from 'events';

export type DatabaseDeletionStatus = 'none' | 'inTrash' | 'deleted' | null;

type TrashUpdatedPayload = { workspaceId?: string; trashItems?: View[] };
type TrashUpdatedCallback = (payload: TrashUpdatedPayload) => void;
type TrashUpdatedSubscription = {
  callbacks: Set<TrashUpdatedCallback>;
  handler: TrashUpdatedCallback;
};

const trashUpdatedSubscriptions = new WeakMap<EventEmitter, TrashUpdatedSubscription>();

function subscribeTrashUpdated(eventEmitter: EventEmitter, callback: TrashUpdatedCallback) {
  let subscription = trashUpdatedSubscriptions.get(eventEmitter);

  if (!subscription) {
    subscription = {
      callbacks: new Set(),
      handler: (payload) => {
        subscription?.callbacks.forEach((subscriber) => subscriber(payload));
      },
    };
    trashUpdatedSubscriptions.set(eventEmitter, subscription);
    eventEmitter.on(APP_EVENTS.TRASH_UPDATED, subscription.handler);
  }

  subscription.callbacks.add(callback);

  return () => {
    const current = trashUpdatedSubscriptions.get(eventEmitter);

    if (!current) return;
    current.callbacks.delete(callback);

    if (current.callbacks.size === 0) {
      eventEmitter.off(APP_EVENTS.TRASH_UPDATED, current.handler);
      trashUpdatedSubscriptions.delete(eventEmitter);
    }
  };
}

interface UseDatabaseDeletionStatusProps {
  workspaceId: string;
  viewId: string;
  databaseId?: string;
  hasDatabase: boolean;
  eventEmitter?: EventEmitter;
  notFound: boolean;
  setNotFound: (notFound: boolean) => void;
}

/**
 * Tracks whether an embedded database's container is in trash or permanently
 * deleted. Mount probes share the workspace trash coordinator; later updates
 * consume the app-level authoritative payload without starting another trash
 * request for every embedded block.
 */
export function useDatabaseDeletionStatus({
  workspaceId,
  viewId,
  databaseId,
  hasDatabase,
  eventEmitter,
  notFound,
  setNotFound,
}: UseDatabaseDeletionStatusProps): DatabaseDeletionStatus {
  const [deletionStatus, setDeletionStatus] = useState<DatabaseDeletionStatus>(null);
  const deletionStatusRef = useRef<DatabaseDeletionStatus>(null);
  const lastCheckedTrashItemsRef = useRef<View[] | null>(null);
  const notFoundRef = useRef(notFound);
  const lastKnownParentRef = useRef<{ viewId: string; parentId: string } | null>(null);

  notFoundRef.current = notFound;

  useEffect(() => {
    if (!eventEmitter || !viewId || !hasDatabase || !workspaceId) return;

    let cancelled = false;
    let checkRequestSeq = 0;

    deletionStatusRef.current = null;
    lastCheckedTrashItemsRef.current = null;
    setDeletionStatus((current) => (current === null ? current : null));

    const confirmDeletionStatus = (status: Exclude<DatabaseDeletionStatus, null>) => {
      deletionStatusRef.current = status;
      setDeletionStatus(status);
    };

    const settleAsActiveIfUnconfirmed = () => {
      if (deletionStatusRef.current !== null) return;
      confirmDeletionStatus('none');
    };

    const checkView = async (refreshView: boolean, freshTrashItems?: View[]) => {
      const requestSeq = ++checkRequestSeq;

      try {
        const [viewResult, trashResult] = await Promise.allSettled([
          refreshView ? ViewService.refresh(workspaceId, viewId) : ViewService.get(workspaceId, viewId),
          freshTrashItems === undefined ? ViewService.getTrashCached(workspaceId) : Promise.resolve(freshTrashItems),
        ]);

        // A mount check may finish after a TRASH_UPDATED-driven check. Never
        // let that older result restore stale deletion state or parent metadata.
        if (cancelled || requestSeq !== checkRequestSeq) return;

        const viewMeta = viewResult.status === 'fulfilled' ? viewResult.value : null;
        const viewGone = viewResult.status === 'rejected' && isViewGoneError(viewResult.reason);
        const trashItems = trashResult.status === 'fulfilled' ? trashResult.value : null;

        if (trashItems) {
          lastCheckedTrashItemsRef.current = trashItems;
        }

        // Transient failure is not proof that the database was deleted.
        if (viewResult.status === 'rejected' && !viewGone && trashResult.status === 'rejected') {
          settleAsActiveIfUnconfirmed();
          return;
        }

        if (viewMeta?.parent_view_id) {
          lastKnownParentRef.current = { viewId, parentId: viewMeta.parent_view_id };
        }

        const cachedParentId =
          lastKnownParentRef.current?.viewId === viewId ? lastKnownParentRef.current.parentId : null;
        const parentId = viewMeta?.parent_view_id ?? cachedParentId;
        const idsToCheck = new Set<string>([viewId]);

        if (parentId) {
          idsToCheck.add(parentId);
        }

        const isInTrash = trashItems?.some(
          (item) =>
            idsToCheck.has(item.view_id) ||
            (!!databaseId && item.extra?.is_database_container === true && item.extra?.database_id === databaseId)
        );

        if (isInTrash) {
          confirmDeletionStatus('inTrash');

          if (!notFoundRef.current) {
            setNotFound(true);
          }
        } else if (viewGone && !viewMeta) {
          confirmDeletionStatus('deleted');

          if (!notFoundRef.current) {
            setNotFound(true);
          }
        } else if (viewMeta) {
          confirmDeletionStatus('none');

          if (notFoundRef.current) {
            setNotFound(false);
          }
        } else if (viewResult.status === 'rejected' && !viewGone && trashResult.status === 'fulfilled') {
          // An empty authoritative trash result plus a transient metadata
          // failure is enough to render an otherwise valid embedded database.
          // Never overwrite a previously confirmed trash/deletion state.
          settleAsActiveIfUnconfirmed();
        }
      } catch {
        // Network error — preserve the last confirmed state.
      }
    };

    void checkView(false);

    const handleTrashUpdated = (payload: TrashUpdatedPayload) => {
      if (payload?.workspaceId !== workspaceId || !Array.isArray(payload.trashItems)) return;
      if (deletionStatusRef.current !== null && lastCheckedTrashItemsRef.current === payload.trashItems) return;

      void checkView(true, payload.trashItems);
    };

    const unsubscribeTrashUpdated = subscribeTrashUpdated(eventEmitter, handleTrashUpdated);

    return () => {
      cancelled = true;
      checkRequestSeq += 1;
      unsubscribeTrashUpdated();
    };
  }, [databaseId, eventEmitter, hasDatabase, setNotFound, viewId, workspaceId]);

  return deletionStatus;
}
