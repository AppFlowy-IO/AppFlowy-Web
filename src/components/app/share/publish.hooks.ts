import React, { useCallback, useEffect, useMemo } from 'react';

import { UpdatePublishConfigPayload, View } from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';
import { notify } from '@/components/_shared/notify';
import { useAppView, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { ViewService, PublishService } from '@/application/services/domains';
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
  const requestKey = candidateViewIds.join(':');
  const [publishState, setPublishState] = React.useState<{
    requestKey: string;
    viewId: string;
    publishInfo?: PublishInfo;
  }>();
  const publishInfoRequestSeqRef = React.useRef(0);
  const [loading, setLoading] = React.useState<boolean>(false);

  const currentPublishState = publishState?.requestKey === requestKey ? publishState : undefined;
  const publishInfoViewId = currentPublishState?.viewId ?? viewId;
  const publishInfo = currentPublishState?.publishInfo;
  const view = publishInfoViewId === fallbackViewId ? fallbackView : primaryView;
  const currentUser = useCurrentUser();
  const isOwner = isSameUserUid(userWorkspaceInfo?.selectedWorkspace?.owner?.uid, currentUser?.uid);
  const isPublisher = publishInfo?.publisherEmail === currentUser?.email;

  const loadPublishInfo = useCallback(async () => {
    const requestSeq = publishInfoRequestSeqRef.current + 1;

    publishInfoRequestSeqRef.current = requestSeq;

    setLoading(true);
    try {
      const results = await Promise.allSettled(
        candidateViewIds.map((candidateViewId) => PublishService.getViewInfo(candidateViewId))
      );

      if (publishInfoRequestSeqRef.current !== requestSeq) return;

      const publishedResultIndex = results.findIndex((result) => result.status === 'fulfilled');

      if (publishedResultIndex === -1) {
        setPublishState({ requestKey, viewId });
      } else {
        const publishedResult = results[publishedResultIndex];

        if (publishedResult.status === 'fulfilled') {
          setPublishState({
            requestKey,
            viewId: candidateViewIds[publishedResultIndex],
            publishInfo: publishedResult.value,
          });
        }
      }
    } finally {
      if (publishInfoRequestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [candidateViewIds, requestKey, viewId]);

  useEffect(() => {
    void loadPublishInfo();
  }, [loadPublishInfo]);

  const updatePublishConfig = useCallback(
    async (payload: UpdatePublishConfigPayload) => {
      if (!workspaceId) return;
      try {
        await PublishService.updateConfig(workspaceId, payload);
        setPublishState((previousState) => {
          if (!previousState?.publishInfo || previousState.requestKey !== requestKey) return previousState;
          return {
            ...previousState,
            publishInfo: {
              publishName: payload.publish_name || previousState.publishInfo.publishName,
              namespace: previousState.publishInfo.namespace,
              publisherEmail: previousState.publishInfo.publisherEmail,
              commentEnabled:
                payload.comments_enabled === undefined
                  ? previousState.publishInfo.commentEnabled
                  : payload.comments_enabled,
              duplicateEnabled:
                payload.duplicate_enabled === undefined
                  ? previousState.publishInfo.duplicateEnabled
                  : payload.duplicate_enabled,
            },
          };
        });
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [requestKey, workspaceId]
  );

  const url = useMemo(() => {
    return `${window.origin}/${publishInfo?.namespace}/${publishInfo?.publishName}`;
  }, [publishInfo]);

  return {
    publishInfo,
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
