import { Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as PublishIcon } from '@/assets/icons/earth.svg';
import { notify } from '@/components/_shared/notify';
import { Switch } from '@/components/_shared/switch';
import { usePublishing } from '@/components/app/app.hooks';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import PublishLinkPreview from '@/components/app/share/PublishLinkPreview';

function PublishPanel({
  viewId,
  fallbackViewId,
  opened,
  onClose,
  onOpenPublishManage,
  canShare,
  shareDetailsLoading,
}: {
  viewId: string;
  fallbackViewId?: string;
  onClose: () => void;
  opened: boolean;
  onOpenPublishManage?: () => void;
  canShare: boolean;
  shareDetailsLoading?: boolean;
}) {
  const { t } = useTranslation();
  const { publish, unpublish } = usePublishing();
  const {
    url,
    loadPublishInfo,
    view,
    publishInfo,
    publishInfoViewId,
    loading,
    isOwner,
    isPublisher,
    updatePublishConfig,
  } = useLoadPublishInfo(viewId, fallbackViewId);
  const [unpublishLoading, setUnpublishLoading] = React.useState<boolean>(false);
  const [publishLoading, setPublishLoading] = React.useState<boolean>(false);
  // Track publish/unpublish actions locally so the panel updates immediately,
  // even when the view object (e.g. server fallback) has a stale is_published flag.
  const [publishedOverride, setPublishedOverride] = React.useState<boolean | undefined>(undefined);
  const [commentEnabled, setCommentEnabled] = React.useState<boolean | undefined>(undefined);
  const [duplicateEnabled, setDuplicateEnabled] = React.useState<boolean | undefined>(undefined);

  // Reset session-local overrides when the target view changes
  useEffect(() => {
    setPublishedOverride(undefined);
  }, [publishInfoViewId]);

  useEffect(() => {
    if (opened) {
      void loadPublishInfo();
    }
  }, [loadPublishInfo, opened]);

  useEffect(() => {
    if (opened && publishInfo) {
      setCommentEnabled(publishInfo.commentEnabled);
      setDuplicateEnabled(publishInfo.duplicateEnabled);
    }
  }, [opened, publishInfo]);

  const handlePublish = useCallback(
    async (publishName?: string) => {
      if (!publish || !view) return;

      setPublishLoading(true);
      const newPublishName = publishName || publishInfo?.publishName || undefined;

      try {
        await publish(view, newPublishName);
        setPublishedOverride(true);
        await loadPublishInfo();
        notify.success(t('publish.publishSuccessfully'));
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      } finally {
        setPublishLoading(false);
      }
    },
    [loadPublishInfo, publish, t, view, publishInfo]
  );

  const handleUnpublish = useCallback(async () => {
    if (!view || !unpublish) return;
    if (!isOwner && !isPublisher) {
      notify.error(t('settings.sites.error.unPublishPermissionDenied'));
      return;
    }

    setUnpublishLoading(true);

    try {
      await unpublish(publishInfoViewId);
      setPublishedOverride(false);
      await loadPublishInfo();
      notify.success(t('publish.unpublishSuccessfully'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setUnpublishLoading(false);
    }
  }, [isOwner, isPublisher, loadPublishInfo, publishInfoViewId, t, unpublish, view]);

  const scopedPublishInfo = publishInfo;

  const renderPublished = useCallback(() => {
    if (!scopedPublishInfo || !view) return null;
    return (
      <div className={'flex flex-col gap-5'}>
        <PublishLinkPreview
          viewId={publishInfoViewId}
          publishInfo={scopedPublishInfo}
          url={url}
          updatePublishConfig={updatePublishConfig}
          onUnPublish={handleUnpublish}
          isOwner={isOwner}
          isPublisher={isPublisher}
          onClose={onClose}
          onOpenPublishManage={onOpenPublishManage}
        />
        <div className={'flex w-full items-center justify-end gap-4'}>
          <Button
            className={'max-w-[50%] flex-1'}
            onClick={() => {
              void handleUnpublish();
            }}
            color={'inherit'}
            variant={'outlined'}
            startIcon={unpublishLoading ? <CircularProgress size={16} /> : undefined}
            data-testid={'unpublish-button'}
          >
            {t('shareAction.unPublish')}
          </Button>
          <Button
            className={'max-w-[50%] flex-1'}
            onClick={() => {
              window.open(url, '_blank');
            }}
            data-testid={'visit-site-button'}
            variant={'contained'}
          >
            {t('shareAction.visitSite')}
          </Button>
        </div>
        <div className={'flex flex-col'}>
          <div className={'flex items-center justify-between gap-4 p-1.5 text-sm'}>
            <span>{t('comments')}</span>
            <Switch
              checked={commentEnabled !== false}
              onChange={(e) => {
                setCommentEnabled(e.target.checked);
                void updatePublishConfig({ comments_enabled: e.target.checked, view_id: publishInfoViewId });
              }}
              size={'small'}
              inputProps={{ 'data-testid': 'publish-comments-switch' } as React.InputHTMLAttributes<HTMLInputElement>}
            />
          </div>
          <div className={'flex  items-center justify-between gap-4 p-1.5 text-sm'}>
            <span>{t('duplicateAsTemplate')}</span>
            <Switch
              checked={duplicateEnabled !== false}
              onChange={(e) => {
                setDuplicateEnabled(e.target.checked);
                void updatePublishConfig({ duplicate_enabled: e.target.checked, view_id: publishInfoViewId });
              }}
              size={'small'}
            />
          </div>
        </div>
      </div>
    );
  }, [
    scopedPublishInfo,
    view,
    url,
    handleUnpublish,
    isOwner,
    isPublisher,
    onClose,
    unpublishLoading,
    t,
    commentEnabled,
    duplicateEnabled,
    updatePublishConfig,
    publishInfoViewId,
    onOpenPublishManage,
  ]);

  // Use the publish API (scopedPublishInfo) as the authoritative source.
  // view.is_published from the outline can be stale after unpublish.
  const serverPublishedState = Boolean(scopedPublishInfo);
  // Reconcile local override with fetched/server state:
  // - local override is authoritative for immediate UI feedback
  // - fallback to server-derived state when no local override exists
  const hasPublished = publishedOverride ?? serverPublishedState;

  const renderUnpublished = useCallback(() => {
    if (!view) return null;
    const publishDisabled = !canShare || shareDetailsLoading || publishLoading;
    const publishButton = (
      <Button
        onClick={() => {
          if (!canShare) return;
          void handlePublish();
        }}
        variant={'contained'}
        className={'w-full'}
        data-testid={'publish-confirm-button'}
        color={'primary'}
        disabled={publishDisabled}
        startIcon={publishLoading ? <CircularProgress color={'inherit'} size={16} /> : undefined}
      >
        {t('shareAction.publish')}
      </Button>
    );

    return (
      <div className={'flex w-full flex-col gap-4'}>
        <Tooltip disableHoverListener={canShare} title={!canShare ? t('shareAction.readOnlyPublishTooltip') : ''}>
          <span className={'w-full'}>{publishButton}</span>
        </Tooltip>
      </div>
    );
  }, [canShare, handlePublish, publishLoading, shareDetailsLoading, t, view]);

  return (
    <div className='flex flex-col items-start gap-1 self-stretch px-3 py-4'>
      <div className={'flex w-full flex-col gap-2 overflow-hidden'}>
        <Typography className={'flex items-center gap-1.5'} variant={'body2'}>
          <PublishIcon className={'h-5 w-5'} />
          {t('shareAction.publishToTheWeb')}
        </Typography>
        <Typography className={'text-text-secondary'} variant={'caption'}>
          {t('shareAction.publishToTheWebHint')}
        </Typography>
        {loading && (
          <div className={'flex w-full items-center justify-center'}>
            <CircularProgress size={20} />
          </div>
        )}
        <div
          style={{
            visibility: loading ? 'hidden' : 'visible',
            height: loading ? 0 : 'auto',
          }}
          className={'overflow-hidden'}
        >
          {hasPublished ? renderPublished() : renderUnpublished()}
        </div>
      </div>
    </div>
  );
}

export default PublishPanel;
