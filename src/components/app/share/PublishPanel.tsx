import { notify } from '@/components/_shared/notify';
import { useAppHandlers } from '@/components/app/app.hooks';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import PublishLinkPreview from '@/components/app/share/PublishLinkPreview';
import { Button, CircularProgress, Typography } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as PublishIcon } from '@/assets/publish.svg';

function PublishPanel ({ viewId, opened, onClose }: { viewId: string; onClose: () => void; opened: boolean }) {
  const { t } = useTranslation();
  const {
    publish,
    unpublish,
  } = useAppHandlers();
  const {
    url,
    loadPublishInfo,
    view,
    publishInfo,
    loading,
    isOwner,
    isPublisher,
  } = useLoadPublishInfo(viewId);
  const [unpublishLoading, setUnpublishLoading] = React.useState<boolean>(false);
  const [publishLoading, setPublishLoading] = React.useState<boolean>(false);

  useEffect(() => {
    if (opened) {
      void loadPublishInfo();
    }
  }, [loadPublishInfo, opened]);

  const handlePublish = useCallback(async (publishName?: string) => {
    if (!publish || !view) return;

    setPublishLoading(true);
    try {
      await publish(view, publishName || publishInfo?.publishName);
      await loadPublishInfo();
      notify.success(t('publish.publishSuccessfully'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setPublishLoading(false);
    }
  }, [loadPublishInfo, publish, t, view, publishInfo]);

  const handleUnpublish = useCallback(async () => {
    if (!view || !unpublish) return;
    if (!isOwner && !isPublisher) {
      notify.error(t('settings.sites.error.unPublishPermissionDenied'));
      return;
    }

    setUnpublishLoading(true);

    try {
      await unpublish(viewId);
      await loadPublishInfo();
      notify.success(t('publish.unpublishSuccessfully'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setUnpublishLoading(false);
    }
  }, [isOwner, isPublisher, loadPublishInfo, t, unpublish, view, viewId]);

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
        onClose={onClose}
      />
      <div className={'flex items-center gap-4 justify-end w-full'}>
        <Button
          className={'flex-1 max-w-[50%]'}
          onClick={() => {
            void handleUnpublish();
          }}
          color={'inherit'}
          variant={'outlined'}
          startIcon={unpublishLoading ? <CircularProgress size={16} /> : undefined}
        >{
          t('shareAction.unPublish')
        }</Button>
        <Button
          className={'flex-1 max-w-[50%]'}
          onClick={() => {
            window.open(url, '_blank');
          }}
          variant={'contained'}
        >{t('shareAction.visitSite')}</Button>
      </div>
    </div>;
  }, [handlePublish, handleUnpublish, isOwner, isPublisher, onClose, publishInfo, t, unpublishLoading, url, view]);

  const renderUnpublished = useCallback(() => {
    return <Button
      onClick={() => {
        void handlePublish();
      }}
      variant={'contained'}
      className={'w-full'}
      color={'primary'}
      startIcon={publishLoading ? <CircularProgress
        color={'inherit'}
        size={16}
      /> : undefined}
    >{
      t('shareAction.publish')
    }</Button>;
  }, [handlePublish, publishLoading, t]);

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