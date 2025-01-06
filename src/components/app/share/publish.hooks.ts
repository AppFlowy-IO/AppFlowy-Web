import { View } from '@/application/types';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import React, { useCallback, useEffect, useMemo } from 'react';

export function useLoadPublishInfo (viewId: string) {
  const [view, setView] = React.useState<View>();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const [publishInfo, setPublishInfo] = React.useState<{
    namespace: string,
    publishName: string,
    publisherEmail: string
  }>();
  const [loading, setLoading] = React.useState<boolean>(false);
  const service = useService();

  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.owner?.uid.toString() === currentUser?.uid.toString();
  const isPublisher = publishInfo?.publisherEmail === currentUser?.email;
  const loadView = useCallback(async () => {
    if (!viewId || !service || !currentWorkspaceId) return;
    try {

      const view = await service.getAppView(currentWorkspaceId, viewId);

      setView(view);
      return view;
      // eslint-disable-next-line
    } catch (e: any) {
      // do nothing
      console.error(e);
    }
  }, [currentWorkspaceId, service, viewId]);
  const loadPublishInfo = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    try {
      const view = await loadView();

      if (!view) return;

      const res = await service.getPublishInfo(view?.view_id);

      setPublishInfo(res);

      // eslint-disable-next-line
    } catch (e: any) {
      // do nothing
    }

    setLoading(false);
  }, [loadView, service]);

  useEffect(() => {
    void loadPublishInfo();
  }, [loadPublishInfo]);

  const url = useMemo(() => {
    return `${window.origin}/${publishInfo?.namespace}/${publishInfo?.publishName}`;
  }, [publishInfo]);

  return { publishInfo, url, loadPublishInfo, view, loading, isPublisher, isOwner };
}