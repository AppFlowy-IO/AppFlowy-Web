
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

interface PendingViewProbe {
  viewId: string;
  resolve: (view: View) => void;
  reject: (error: unknown) => void;
}

/** Mount probes waiting for the end of the current tick, by workspace. */
const pendingViewProbes = new Map<string, PendingViewProbe[]>();

function flushViewProbes(workspaceId: string) {
  const probes = pendingViewProbes.get(workspaceId) ?? [];
  const viewIds = Array.from(new Set(probes.map((probe) => probe.viewId)));

  pendingViewProbes.delete(workspaceId);

  // Shared by the probes of one view: a lookup of its own gives the server's
  // answer for it (deleted, refused, failed), which the batch cannot.
  const lookups = new Map<string, Promise<View>>();
  const lookUp = (viewId: string) => {
    let lookup = lookups.get(viewId);

    if (!lookup) {
      lookup = ViewService.get(workspaceId, viewId);
      lookups.set(viewId, lookup);
    }

    return lookup;
  };

  const settle = (views: Map<string, View>) => {
    probes.forEach(({ viewId, resolve, reject }) => {
      const view = views.get(viewId);

      if (view) resolve(view);
      else lookUp(viewId).then(resolve, reject);
    });
  };

  if (viewIds.length < 2) {
    settle(new Map());
    return;
  }

  // The batch returns the views it could read and leaves the others out.
  ViewService.getMultiple(workspaceId, viewIds, 1).then(
    (views) => settle(new Map(views.map((view) => [view.view_id, view]))),
    () => settle(new Map())
  );
}

/**
 * The metadata of `viewId` for a mount probe. A dashboard mounts a probe per
 * widget: the lookups of one tick go out as one batch request instead of one
 * request per view. A view already cached is not asked for again.
 */
function loadViewForMountProbe(workspaceId: string, viewId: string): Promise<View> {
  const cached = ViewService.getCached(workspaceId, viewId);

  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    let probes = pendingViewProbes.get(workspaceId);

    if (!probes) {
      probes = [];
      pendingViewProbes.set(workspaceId, probes);
      queueMicrotask(() => flushViewProbes(workspaceId));
    }

    probes.push({ viewId, resolve, reject });
  });
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
 * deleted. Mount probes share the workspace trash coordinator and one batch
 * request for their views; later updates consume the app-level authoritative
 * payload without starting another trash request for every embedded block.
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
          refreshView ? ViewService.refresh(workspaceId, viewId) : loadViewForMountProbe(workspaceId, viewId),
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
