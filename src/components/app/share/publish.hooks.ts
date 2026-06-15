import React, { useCallback, useEffect, useMemo } from 'react';

import { UpdatePublishConfigPayload, View } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useAppView, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { ViewService, PublishService } from '@/application/services/domains';
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
    namespace: string,
    publishName: string,
    publisherEmail: string,
    commentEnabled: boolean,
    duplicateEnabled: boolean,
  }>();
  const [publishInfoViewId, setPublishInfoViewId] = React.useState<string | null>(null);
  const publishInfoRequestSeqRef = React.useRef(0);
  const [loading, setLoading] = React.useState<boolean>(false);

  const currentUser = useCurrentUser();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.owner?.uid.toString() === currentUser?.uid.toString();
  const currentViewPublishInfo = publishInfoViewId === viewId ? publishInfo : undefined;
  const isPublisher = currentViewPublishInfo?.publisherEmail === currentUser?.email;

  const loadPublishInfo = useCallback(async() => {
    const requestSeq = publishInfoRequestSeqRef.current + 1;

    publishInfoRequestSeqRef.current = requestSeq;

    setLoading(true);
    try {
      const res = await PublishService.getViewInfo(viewId);

      if (publishInfoRequestSeqRef.current !== requestSeq) return;
      setPublishInfo(res);
      setPublishInfoViewId(viewId);

      // eslint-disable-next-line
    } catch(e: any) {
      if (publishInfoRequestSeqRef.current !== requestSeq) return;
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

  const updatePublishConfig = useCallback(async(payload: UpdatePublishConfigPayload) => {
    if(!workspaceId) return;
    try {
      await PublishService.updateConfig(workspaceId, payload);
      setPublishInfo(prev => {
        if(!prev) return prev;
        return {
          publishName: payload.publish_name || prev.publishName,
          namespace: prev.namespace,
          publisherEmail: prev.publisherEmail,
          commentEnabled: payload.comments_enabled === undefined ? prev.commentEnabled : payload.comments_enabled,
          duplicateEnabled: payload.duplicate_enabled === undefined ? prev.duplicateEnabled : payload.duplicate_enabled,
        };
      });
      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e.message);
    }

  }, [workspaceId]);

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
