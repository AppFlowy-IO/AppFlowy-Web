import { Button, CircularProgress, Divider, Typography } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import { ReactComponent as CheckboxCheckSvg } from '@/assets/icons/check_filled.svg';
import { ReactComponent as PublishIcon } from '@/assets/icons/earth.svg';
import { ReactComponent as CheckboxUncheckSvg } from '@/assets/icons/uncheck.svg';
import { notify } from '@/components/_shared/notify';
import { Switch } from '@/components/_shared/switch';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppHandlers } from '@/components/app/app.hooks';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import PublishLinkPreview from '@/components/app/share/PublishLinkPreview';

function PublishPanel({
  viewId,
  opened,
  onClose,
  onOpenPublishManage,
}: {
  viewId: string;
  onClose: () => void;
  opened: boolean;
  onOpenPublishManage?: () => void;
}) {
  const { t } = useTranslation();
  const { publish, unpublish } = useAppHandlers();
  const { url, loadPublishInfo, view, publishInfo, loading, isOwner, isPublisher, updatePublishConfig } =
    useLoadPublishInfo(viewId);
  const [unpublishLoading, setUnpublishLoading] = React.useState<boolean>(false);
  const [publishLoading, setPublishLoading] = React.useState<boolean>(false);
  const [visibleViewId, setVisibleViewId] = React.useState<string[] | undefined>(undefined);
  const [commentEnabled, setCommentEnabled] = React.useState<boolean | undefined>(undefined);
  const [duplicateEnabled, setDuplicateEnabled] = React.useState<boolean | undefined>(undefined);

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
        await publish(view, newPublishName, visibleViewId);
        await loadPublishInfo();
        notify.success(t('publish.publishSuccessfully'));
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      } finally {
        setPublishLoading(false);
      }
    },
    [loadPublishInfo, publish, t, view, publishInfo, visibleViewId]
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
    return (
      <div className={'flex flex-col gap-5'}>
        <PublishLinkPreview
          viewId={viewId}
          publishInfo={publishInfo}
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
                void updatePublishConfig({ comments_enabled: e.target.checked, view_id: viewId });
              }}
              size={'small'}
            />
          </div>
          <div className={'flex  items-center justify-between gap-4 p-1.5 text-sm'}>
            <span>{t('duplicateAsTemplate')}</span>
            <Switch
              checked={duplicateEnabled !== false}
              onChange={(e) => {
                setDuplicateEnabled(e.target.checked);
                void updatePublishConfig({ duplicate_enabled: e.target.checked, view_id: viewId });
              }}
              size={'small'}
            />
          </div>
        </div>
      </div>
    );
  }, [
    publishInfo,
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
    viewId,
    onOpenPublishManage,
  ]);

  const layout = view?.layout;
  const isDatabase =
    layout !== undefined ? [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar].includes(layout) : false;
  const hasPublished = view?.is_published;

  useEffect(() => {
    if (!hasPublished && isDatabase && view) {
      const childIds = [view.view_id, ...view.children.map((child) => child.view_id)];

      setVisibleViewId(childIds);
    } else {
      setVisibleViewId(undefined);
    }
  }, [hasPublished, isDatabase, view]);

  const renderUnpublished = useCallback(() => {
    if (!view) return null;
    const list = [view, ...view.children];

    return (
      <div className={'flex w-full flex-col gap-4'}>
        {isDatabase && (
          <div className={'mt-2 flex flex-col gap-3 rounded-[16px] border border-border-primary px-4 py-3 text-sm'}>
            <div className={'text-text-secondary'}>
              {t('publishSelectedViews', {
                count: visibleViewId?.length || 0,
              })}
            </div>
            <Divider />
            <div className={'appflowy-scroller flex max-h-[300px] flex-col gap-1 overflow-y-auto overflow-x-hidden'}>
              {list.map((item) => {
                const id = item.view_id;
                const isCurrentView = view.view_id === item.view_id;

                const selected = visibleViewId?.includes(item.view_id);

                return (
                  <Button
                    disabled={isCurrentView}
                    onClick={() => {
                      setVisibleViewId((prev) => {
                        const checked = prev?.includes(id);

                        if (checked) {
                          return prev?.filter((i) => i !== id);
                        } else {
                          return [...(prev || []), id];
                        }
                      });
                    }}
                    key={id}
                    className={'flex items-center justify-start'}
                    size={'small'}
                    startIcon={
                      selected ? (
                        <CheckboxCheckSvg />
                      ) : (
                        <CheckboxUncheckSvg className={'text-border-primary hover:text-border-primary-hover'} />
                      )
                    }
                    color={'inherit'}
                  >
                    <div className={'flex items-center gap-2'}>
                      <PageIcon view={item} className={'h-5 w-5'} />
                      {item.name || t('untitled')}
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        <Button
          onClick={() => {
            void handlePublish();
          }}
          variant={'contained'}
          className={'w-full'}
          data-testid={'publish-confirm-button'}
          color={'primary'}
          startIcon={publishLoading ? <CircularProgress color={'inherit'} size={16} /> : undefined}
        >
          {t('shareAction.publish')}
        </Button>
      </div>
    );
  }, [handlePublish, isDatabase, publishLoading, t, view, visibleViewId]);

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
          {view?.is_published ? renderPublished() : renderUnpublished()}
        </div>
      </div>
    </div>
  );
}

export default PublishPanel;
