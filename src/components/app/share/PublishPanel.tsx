import { Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { cachePublishCommentsEnabled, useCachedPublishCommentsEnabled } from '@/application/publish/comment-state';
import { clearPublishViewInfoCache } from '@/application/services/js-services/cached-api';
import { ReactComponent as PublishIcon } from '@/assets/icons/earth.svg';
import { notify } from '@/components/_shared/notify';
import { Switch } from '@/components/_shared/switch';
import { usePublishing } from '@/components/app/app.hooks';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import PublishLinkPreview from '@/components/app/share/PublishLinkPreview';

function PublishPanel({
  viewId,
  opened,
  onClose,
  onOpenPublishManage,
  canShare,
  shareDetailsLoading,
}: {
  viewId: string;
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
  } = useLoadPublishInfo(viewId);
  const publishedCommentEnabled = publishInfo?.commentEnabled;
  const publishedDuplicateEnabled = publishInfo?.duplicateEnabled;
  const [unpublishLoading, setUnpublishLoading] = React.useState<boolean>(false);
  const [publishLoading, setPublishLoading] = React.useState<boolean>(false);
  // Track publish/unpublish actions locally so the panel updates immediately,
  // even when the view object (e.g. server fallback) has a stale is_published flag.
  const [publishedOverride, setPublishedOverride] = React.useState<boolean | undefined>(undefined);
  const cachedCommentEnabled = useCachedPublishCommentsEnabled(viewId);
  const [pendingCommentChange, setPendingCommentChange] = React.useState<{
    viewId: string;
    enabled: boolean;
  }>();
  const pendingCommentEnabled = pendingCommentChange?.viewId === viewId ? pendingCommentChange.enabled : undefined;
  const commentsEnabledForPublish = pendingCommentEnabled ?? cachedCommentEnabled ?? publishedCommentEnabled;
  const commentEnabled = commentsEnabledForPublish ?? false;
  const commentUpdatePending = pendingCommentEnabled !== undefined;
  const [duplicateEnabled, setDuplicateEnabled] = React.useState<boolean | undefined>(undefined);

  // Reset the immediate publish-state override when the target view changes.
  useEffect(() => {
    setPublishedOverride(undefined);
  }, [viewId]);

  useEffect(() => {
    if (opened) {
      void loadPublishInfo();
    }
  }, [loadPublishInfo, opened]);

  useEffect(() => {
    if (!opened || publishedCommentEnabled === undefined || publishInfoViewId !== viewId) return;

    cachePublishCommentsEnabled(viewId, publishedCommentEnabled);
  }, [opened, publishedCommentEnabled, publishInfoViewId, viewId]);

  useEffect(() => {
    if (!opened || publishedDuplicateEnabled === undefined || publishInfoViewId !== viewId) return;

    setDuplicateEnabled(publishedDuplicateEnabled);
  }, [opened, publishedDuplicateEnabled, publishInfoViewId, viewId]);

  useEffect(() => {
    if (!opened || publishedCommentEnabled === undefined) return;

    if (cachedCommentEnabled === undefined) {
      cachePublishCommentsEnabled(viewId, publishedCommentEnabled);
      return;
    }

    if (cachedCommentEnabled === publishedCommentEnabled) return;

    clearPublishViewInfoCache(viewId);
    void loadPublishInfo();
  }, [cachedCommentEnabled, loadPublishInfo, opened, publishedCommentEnabled, viewId]);

  const handlePublish = useCallback(
    async (publishName?: string) => {
      if (!publish || !view) return;

      setPublishLoading(true);
      const newPublishName = publishName || publishInfo?.publishName || undefined;

      try {
        await publish(view, newPublishName, undefined, commentsEnabledForPublish);
        if (commentsEnabledForPublish !== undefined) {
          cachePublishCommentsEnabled(viewId, commentsEnabledForPublish);
        }

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
    [commentsEnabledForPublish, loadPublishInfo, publish, t, view, publishInfo, viewId]
  );

  const handleUnpublish = useCallback(async () => {
    if (!view || !unpublish) return;
    if (!isOwner && !isPublisher) {
      notify.error(t('settings.sites.error.unPublishPermissionDenied'));
      return;
    }

    setUnpublishLoading(true);

    try {
      await unpublish(viewId);
      setPublishedOverride(false);
      await loadPublishInfo();
      notify.success(t('publish.unpublishSuccessfully'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setUnpublishLoading(false);
    }
  }, [isOwner, isPublisher, loadPublishInfo, t, unpublish, view, viewId]);

  const scopedPublishInfo = publishInfoViewId === viewId ? publishInfo : undefined;

  const renderPublished = useCallback(() => {
    if (!scopedPublishInfo || !view) return null;
    return (
      <div className={'flex flex-col gap-5'}>
        <PublishLinkPreview
          viewId={viewId}
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
              checked={commentEnabled}
              disabled={commentUpdatePending}
              onChange={(e) => {
                const enabled = e.target.checked;

                setPendingCommentChange({ viewId, enabled });
                void updatePublishConfig({ comments_enabled: enabled, view_id: viewId }).then((updated) => {
                  if (updated) cachePublishCommentsEnabled(viewId, enabled);
                  setPendingCommentChange((current) =>
                    current?.viewId === viewId && current.enabled === enabled ? undefined : current
                  );
                });
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
                const previousValue = duplicateEnabled !== false;
                const enabled = e.target.checked;

                setDuplicateEnabled(enabled);
                void updatePublishConfig({ duplicate_enabled: enabled, view_id: viewId }).then((updated) => {
                  if (!updated) setDuplicateEnabled(previousValue);
                });
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
    commentUpdatePending,
    duplicateEnabled,
    updatePublishConfig,
    viewId,
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
