import { ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import PublishLinkPreview from '@/components/app/share/PublishLinkPreview';
import { useService } from '@/components/main/app.hooks';
import { Button, CircularProgress, Typography } from '@mui/material';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as PublishIcon } from '@/assets/publish.svg';

function PublishPanel ({ viewId }: { viewId: string }) {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { t } = useTranslation();
  const {
    url,
    loadPublishInfo,
    view,
    publishInfo,
    loading,
    isOwner,
    isPublisher,
  } = useLoadPublishInfo(viewId);

  const service = useService();
  const handlePublish = useCallback(async (publishName?: string) => {
    if (!service || !currentWorkspaceId || !view) return;
    const isDatabase = [ViewLayout.Board, ViewLayout.Grid, ViewLayout.Calendar].includes(view.layout);

    try {
      await service.publishView(currentWorkspaceId, viewId, {
        publish_name: publishName,
        visible_database_view_ids: isDatabase ? view.children?.map((v) => v.view_id) : undefined,
      });
      await loadPublishInfo();
      notify.success(t('publish.publishSuccessfully'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    }
  }, [currentWorkspaceId, loadPublishInfo, service, t, view, viewId]);

  const handleUnpublish = useCallback(async () => {
    if (!service || !currentWorkspaceId || !view) return;
    if (!isOwner && !isPublisher) {
      notify.error(t('settings.sites.error.publishPermissionDenied'));
      return;
    }

    try {
      await service.unpublishView(currentWorkspaceId, viewId);
      await loadPublishInfo();
      notify.success(t('publish.unpublishSuccessfully'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    }
  }, [currentWorkspaceId, isOwner, isPublisher, loadPublishInfo, service, t, view, viewId]);

  const renderPublished = useCallback(() => {
    if (!publishInfo || !view) return null;
    return <div className={'flex flex-col gap-4'}>
      <PublishLinkPreview
        publishInfo={publishInfo}
        url={url}
        onPublish={handlePublish}
        onUnPublish={handleUnpublish}
        isOwner={isOwner}
        isPublisher={isPublisher}
      />
      <div className={'flex items-center gap-4 justify-end w-full'}>
        <Button
          className={'flex-1 max-w-[50%]'}
          onClick={() => {
            void handleUnpublish();
          }}
          color={'inherit'}
          variant={'outlined'}
        >{t('shareAction.unPublish')}</Button>
        <Button
          className={'flex-1 max-w-[50%]'}
          onClick={() => {
            window.open(url, '_blank');
          }}
          variant={'contained'}
        >{t('shareAction.visitSite')}</Button>
      </div>
    </div>;
  }, [handlePublish, handleUnpublish, isOwner, isPublisher, publishInfo, t, url, view]);

  const renderUnpublished = useCallback(() => {
    return <Button
      onClick={() => {
        void handlePublish();
      }}
      variant={'contained'}
      className={'w-full'}
      color={'primary'}
    >{t('shareAction.publish')}</Button>;
  }, [handlePublish, t]);

  return (
    <div className={'flex flex-col gap-2 w-full overflow-hidden'}>
      <Typography
        className={'flex items-center gap-1.5'}
        variant={'body2'}
      >
        <PublishIcon className={'w-4 h-4'} />
        {t('shareAction.publishToTheWeb')}
      </Typography>
      <Typography
        className={'text-text-caption'}
        variant={'caption'}
      >{t('shareAction.publishToTheWebHint')}</Typography>
      {loading && <div className={'flex justify-center w-full items-center'}><CircularProgress size={20} /></div>}
      <div
        style={{
          visibility: loading ? 'hidden' : 'visible',
          height: loading ? 0 : 'auto',
        }}
        className={'overflow-hidden'}
      >
        {view?.is_published ? renderPublished() : renderUnpublished()}
      </div>

    </div>
  );
}

export default PublishPanel;