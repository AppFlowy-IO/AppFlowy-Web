import React, { useCallback, useEffect, useMemo } from 'react';

import { PublishConfig, UpdatePublishConfigPayload, View } from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';
import { notify } from '@/components/_shared/notify';
import { useAppView, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { ViewService, PublishService } from '@/application/services/domains';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { useCurrentUser } from '@/components/main/app.hooks';

type PublishInfo = {
  namespace: string;
  publishName: string;
  publisherEmail: string;
  commentEnabled: boolean;
  duplicateEnabled: boolean;
};

function usePublishView(viewId: string | undefined, workspaceId: string | undefined) {
  const outlineView = useAppView(viewId);
  const [fetchedView, setFetchedView] = React.useState<View | null>(null);

  useEffect(() => {
    if (outlineView || !viewId || !workspaceId) {
      if (outlineView) {
        setFetchedView((previousView) => (previousView?.view_id === viewId ? null : previousView));
      }

      return;
    }

    let cancelled = false;

    ViewService.get(workspaceId, viewId)
      .then((view) => {
        if (!cancelled && view) {
          setFetchedView(view);
        }
      })
      .catch(() => {
        // The publish-info request remains useful even when folder metadata is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [outlineView, viewId, workspaceId]);

  return outlineView ?? (fetchedView?.view_id === viewId ? fetchedView : undefined);
}

export function useLoadPublishInfo(viewId: string, fallbackViewId?: string) {
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const workspaceId = userWorkspaceInfo?.selectedWorkspace?.id;
  const primaryView = usePublishView(viewId, workspaceId);
  const fallbackView = usePublishView(fallbackViewId, workspaceId);
  // Desktop publications are keyed by the active database child. Older Web
  // publications can be keyed by the container, so probe both without a waterfall.
  const candidateViewIds = useMemo(
    () => (fallbackViewId && fallbackViewId !== viewId ? [viewId, fallbackViewId] : [viewId]),
    [fallbackViewId, viewId]
  );
  const requestKey = `${workspaceId}:${candidateViewIds.join(':')}`;
  const [publishState, setPublishState] = React.useState<{
    requestKey: string;
    viewId: string;
    publishInfo?: PublishInfo;
    publishConfig?: PublishConfig;
  }>();
  const publishInfoRequestSeqRef = React.useRef(0);
  const publishInfoMutationSeqRef = React.useRef(0);
  const publishInfoMutationPendingRef = React.useRef(0);
  const publishInfoMutationQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = React.useState<boolean>(false);

  const currentPublishState = publishState?.requestKey === requestKey ? publishState : undefined;
  const publishInfoViewId = currentPublishState?.viewId ?? viewId;
  const publishInfo = currentPublishState?.publishInfo;
  const publishConfig = currentPublishState?.publishConfig;
  const view = publishInfoViewId === fallbackViewId ? fallbackView : primaryView;
  const currentUser = useCurrentUser();
  const isOwner = isSameUserUid(userWorkspaceInfo?.selectedWorkspace?.owner?.uid, currentUser?.uid);
  const isPublisher = publishInfo?.publisherEmail === currentUser?.email;

  const loadPublishInfo = useCallback(async () => {
    if (!workspaceId) return;

    const requestSeq = publishInfoRequestSeqRef.current + 1;
    const mutationSeq = publishInfoMutationSeqRef.current;

    publishInfoRequestSeqRef.current = requestSeq;

    setLoading(true);
    try {
      const results = await Promise.all(
        candidateViewIds.map(async (candidateViewId) => {
          clearPublishViewInfoCache(candidateViewId);
          const [info, config] = await Promise.allSettled([
            PublishService.getViewInfo(candidateViewId),
            PublishService.getConfig(workspaceId, candidateViewId),
          ]);

          return { info, config };
        })
      );

      const stale =
        publishInfoRequestSeqRef.current !== requestSeq ||
        publishInfoMutationSeqRef.current !== mutationSeq ||
        publishInfoMutationPendingRef.current > 0;

      if (stale) {
        candidateViewIds.forEach((candidateViewId) => clearPublishViewInfoCache(candidateViewId));
        return;
      }

      const publishedIndex = results.findIndex((result) => result.info.status === 'fulfilled');
      // An unpublished database can still have saved config under its legacy
      // container ID. Keep that identity when the public endpoint returns 404.
      const savedIndex = results.findIndex((result) => result.config.status === 'fulfilled');
      const selectedIndex = publishedIndex >= 0 ? publishedIndex : savedIndex >= 0 ? savedIndex : 0;
      const selected = results[selectedIndex];
      const info = selected.info.status === 'fulfilled' ? selected.info.value : undefined;
      const config =
        selected.config.status === 'fulfilled'
          ? selected.config.value
          : info
          ? { comments_enabled: info.commentEnabled, duplicate_enabled: info.duplicateEnabled }
          : undefined;

      setPublishState({
        requestKey,
        viewId: candidateViewIds[selectedIndex],
        publishInfo: info,
        publishConfig: config,
      });
    } finally {
      if (publishInfoRequestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [candidateViewIds, requestKey, workspaceId]);

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
          const { view_id: targetViewId, publish_name: publishName, ...configPatch } = payload;
          let savedConfig: PublishConfig | undefined;

          if (publishName !== undefined) {
            await PublishService.updateConfig(workspaceId, payload);
          } else {
            savedConfig = await PublishService.updateSettings(workspaceId, targetViewId, configPatch);
          }

          const savedComments = savedConfig?.comments_enabled ?? payload.comments_enabled;

          setPublishState((previousState) => {
            if (!previousState || previousState.requestKey !== requestKey || previousState.viewId !== payload.view_id)
              return previousState;
            return {
              ...previousState,
              publishConfig:
                savedConfig ??
                (previousState.publishConfig ? { ...previousState.publishConfig, ...configPatch } : undefined),
              publishInfo: previousState.publishInfo
                ? {
                    ...previousState.publishInfo,
                    publishName: publishName || previousState.publishInfo.publishName,
                    commentEnabled: savedComments ?? previousState.publishInfo.commentEnabled,
                    duplicateEnabled:
                      savedConfig?.duplicate_enabled ??
                      payload.duplicate_enabled ??
                      previousState.publishInfo.duplicateEnabled,
                  }
                : undefined,
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
    [requestKey, workspaceId]
  );

  const url = useMemo(() => {
    return `${window.origin}/${publishInfo?.namespace}/${publishInfo?.publishName}`;
  }, [publishInfo]);

  return {
    publishInfo,
    publishConfig,
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
