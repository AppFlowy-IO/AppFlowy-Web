import React, { useCallback, useEffect, useMemo } from 'react';

import { cachePublishCommentsEnabled } from '@/application/publish/comment-state';
import { UpdatePublishConfigPayload, View } from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';
import { notify } from '@/components/_shared/notify';
import { useAppView, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { ViewService, PublishService } from '@/application/services/domains';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { useCurrentUser } from '@/components/main/app.hooks';

export function useLoadPublishInfo(viewId: string) {
  const outlineView = useAppView(viewId);
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const workspaceId = userWorkspaceInfo?.selectedWorkspace?.id;

  // Fallback view fetched from server when not in outline (e.g. lazy-loaded children)
  const [fallbackView, setFallbackView] = React.useState<View | null>(null);

  useEffect(() => {
    if (outlineView || !viewId || !workspaceId) {
      if (outlineView) {
        setFallbackView((prev) => (prev?.view_id === viewId ? null : prev));
      }

      return;
    }

    let cancelled = false;

    ViewService.get(workspaceId, viewId)
      .then((fetchedView) => {
        if (!cancelled && fetchedView) {
          setFallbackView(fetchedView);
        }
      })
      .catch(() => {
        // View not found - ignore
      });

    return () => {
      cancelled = true;
    };
  }, [outlineView, viewId, workspaceId]);

  const view = outlineView ?? (fallbackView?.view_id === viewId ? fallbackView : null) ?? undefined;

  const [publishInfo, setPublishInfo] = React.useState<{
    namespace: string;
    publishName: string;
    publisherEmail: string;
    commentEnabled: boolean;
    duplicateEnabled: boolean;
  }>();
  const [publishInfoViewId, setPublishInfoViewId] = React.useState<string | null>(null);
  const publishInfoRequestSeqRef = React.useRef(0);
  const publishInfoMutationSeqRef = React.useRef(0);
  const publishInfoMutationPendingRef = React.useRef(0);
  const publishInfoMutationQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = React.useState<boolean>(false);

  const currentUser = useCurrentUser();
  const isOwner = isSameUserUid(userWorkspaceInfo?.selectedWorkspace?.owner?.uid, currentUser?.uid);
  const currentViewPublishInfo = publishInfoViewId === viewId ? publishInfo : undefined;
  const isPublisher = currentViewPublishInfo?.publisherEmail === currentUser?.email;

  const loadPublishInfo = useCallback(async () => {
    const requestSeq = publishInfoRequestSeqRef.current + 1;
    const mutationSeq = publishInfoMutationSeqRef.current;

    publishInfoRequestSeqRef.current = requestSeq;

    setLoading(true);
    try {
      const res = await PublishService.getViewInfo(viewId);

      const stale =
        publishInfoRequestSeqRef.current !== requestSeq ||
        publishInfoMutationSeqRef.current !== mutationSeq ||
        publishInfoMutationPendingRef.current > 0;

      if (stale) {
        clearPublishViewInfoCache(viewId);
        return;
      }

      setPublishInfo(res);
      setPublishInfoViewId(viewId);

      // eslint-disable-next-line
    } catch (e: any) {
      const stale =
        publishInfoRequestSeqRef.current !== requestSeq ||
        publishInfoMutationSeqRef.current !== mutationSeq ||
        publishInfoMutationPendingRef.current > 0;

      if (stale) {
        clearPublishViewInfoCache(viewId);
        return;
      }

      // Not published or fetch failed - clear stale publish info
      setPublishInfo(undefined);
      setPublishInfoViewId(viewId);
    } finally {
      if (publishInfoRequestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [viewId]);

  useEffect(() => {
    void loadPublishInfo();
  }, [loadPublishInfo]);

  const updatePublishConfig = useCallback(
    (payload: UpdatePublishConfigPayload): Promise<boolean> => {
      if (!workspaceId) return Promise.resolve(false);

      publishInfoMutationSeqRef.current += 1;
      publishInfoMutationPendingRef.current += 1;

      const mutation = publishInfoMutationQueueRef.current.then(async () => {
        try {
          await PublishService.updateConfig(workspaceId, payload);
          if (payload.comments_enabled !== undefined) {
            cachePublishCommentsEnabled(payload.view_id, payload.comments_enabled);
          }

          setPublishInfo((prev) => {
            if (!prev) return prev;
            return {
              publishName: payload.publish_name || prev.publishName,
              namespace: prev.namespace,
              publisherEmail: prev.publisherEmail,
              commentEnabled: payload.comments_enabled === undefined ? prev.commentEnabled : payload.comments_enabled,
              duplicateEnabled:
                payload.duplicate_enabled === undefined ? prev.duplicateEnabled : payload.duplicate_enabled,
            };
          });
          return true;
          // eslint-disable-next-line
        } catch (e: any) {
          notify.error(e.message);
          return false;
        } finally {
          publishInfoMutationPendingRef.current -= 1;
          // Invalidate reads that began while this mutation was queued or in flight.
          publishInfoMutationSeqRef.current += 1;
        }
      });

      publishInfoMutationQueueRef.current = mutation.then(() => undefined);
      return mutation;
    },
    [workspaceId]
  );

  const url = useMemo(() => {
    return `${window.origin}/${currentViewPublishInfo?.namespace}/${currentViewPublishInfo?.publishName}`;
  }, [currentViewPublishInfo]);

  return {
    publishInfo: currentViewPublishInfo,
    publishInfoViewId,
    url,
    loadPublishInfo,
    view,
    loading,
    isPublisher,
    isOwner,
    updatePublishConfig,
  };
}
