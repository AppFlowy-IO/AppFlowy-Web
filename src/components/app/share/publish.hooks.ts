import { UpdatePublishConfigPayload } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useAppView, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import React, { useCallback, useEffect, useMemo } from 'react';

export function useLoadPublishInfo (viewId: string) {
  const view = useAppView(viewId);
  const [publishInfo, setPublishInfo] = React.useState<{
    namespace: string,
    publishName: string,
    publisherEmail: string,
    commentEnabled: boolean,
    duplicateEnabled: boolean,
  }>();
  const [loading, setLoading] = React.useState<boolean>(false);
  const service = useService();

  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.owner?.uid.toString() === currentUser?.uid.toString();
  const workspaceId = userWorkspaceInfo?.selectedWorkspace?.id;
  const isPublisher = publishInfo?.publisherEmail === currentUser?.email;

  const loadPublishInfo = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    try {
      const res = await service.getPublishInfo(viewId);

      setPublishInfo(res);

      // eslint-disable-next-line
    } catch (e: any) {
      // do nothing
    }

    setLoading(false);
  }, [viewId, service]);

  useEffect(() => {
    void loadPublishInfo();
  }, [loadPublishInfo]);

  const updatePublishConfig = useCallback(async (payload: UpdatePublishConfigPayload) => {
    if (!service || !workspaceId) return;
    try {
      await service.updatePublishConfig(workspaceId, payload);
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    }

  }, [service, workspaceId]);

  const url = useMemo(() => {
    return `${window.origin}/${publishInfo?.namespace}/${publishInfo?.publishName}`;
  }, [publishInfo]);

  return { publishInfo, url, loadPublishInfo, view, loading, isPublisher, isOwner, updatePublishConfig };
}