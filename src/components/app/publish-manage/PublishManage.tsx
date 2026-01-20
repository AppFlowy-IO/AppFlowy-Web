import { Button, CircularProgress, Divider, IconButton, Tooltip } from '@mui/material';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { validate as uuidValidate } from 'uuid';

import { SubscriptionPlan, View } from '@/application/types';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { notify } from '@/components/_shared/notify';
import { flattenViews } from '@/components/_shared/outline/utils';
import { useAppHandlers, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import HomePageSetting from '@/components/app/publish-manage/HomePageSetting';
import PublishedPages from '@/components/app/publish-manage/PublishedPages';
import PublishPagesSkeleton from '@/components/app/publish-manage/PublishPagesSkeleton';
import UpdateNamespace from '@/components/app/publish-manage/UpdateNamespace';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { getProAccessPlanFromSubscriptions, isAppFlowyHosted } from '@/utils/subscription';
import { openUrl } from '@/utils/url';

export function PublishManage({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUser();
  const isOwner = userWorkspaceInfo?.selectedWorkspace?.owner?.uid.toString() === currentUser?.uid.toString();
  const [loading, setLoading] = React.useState<boolean>(false);
  const service = useService();
  const workspaceId = userWorkspaceInfo?.selectedWorkspace?.id;
  const [namespace, setNamespace] = React.useState<string>('');
  const [homePageId, setHomePageId] = React.useState<string>('');
  const [publishViews, setPublishViews] = React.useState<View[]>([]);
  const [updateOpen, setUpdateOpen] = React.useState<boolean>(false);
  const homePage = useMemo(() => {
    return publishViews.find((view) => view.view_id === homePageId);
  }, [homePageId, publishViews]);
  const loadPublishNamespace = useCallback(async () => {
    if (!service || !workspaceId) return;
    try {
      const namespace = await service.getPublishNamespace(workspaceId);

      setNamespace(namespace);

      // eslint-disable-next-line
    } catch (e: any) {
      console.error(e);
    }
  }, [service, workspaceId]);

  const loadHomePageId = useCallback(async () => {
    if (!service || !workspaceId) return;
    try {
      const { view_id } = await service.getPublishHomepage(workspaceId);

      setHomePageId(view_id);

      // eslint-disable-next-line
    } catch (e: any) {
      console.error(e);
    }
  }, [service, workspaceId]);

  const loadPublishPages = useCallback(async () => {
    if (!service || !namespace) return;
    setLoading(true);
    try {
      const outline = await service.getPublishOutline(namespace);

      setPublishViews(
        flattenViews(outline)
          .filter((item) => item.is_published)
          .sort((a, b) => {
            if (!a.publish_timestamp || !b.publish_timestamp) {
              return 0;
            }

            return new Date(b.publish_timestamp).getTime() - new Date(a.publish_timestamp).getTime();
          })
      );
      // eslint-disable-next-line
    } catch (e: any) {
      console.error(e);
    }

    setLoading(false);
  }, [namespace, service]);

  const handleUpdateNamespace = useCallback(
    async (newNamespace: string) => {
      if (!service || !workspaceId) return;
      try {
        await service.updatePublishNamespace(workspaceId, {
          old_namespace: namespace,
          new_namespace: newNamespace,
        });

        setNamespace(newNamespace);
        notify.success(t('settings.sites.success.namespaceUpdated'));
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
        throw e;
      }
    },
    [namespace, service, t, workspaceId]
  );

  const handleUpdateHomePage = useCallback(
    async (newHomePageId: string) => {
      if (!service || !workspaceId) return;
      if (!isOwner) {
        return;
      }

      try {
        await service.updatePublishHomepage(workspaceId, newHomePageId);

        setHomePageId(newHomePageId);
        notify.success(t('settings.sites.success.setHomepageSuccess'));
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
        throw e;
      }
    },
    [isOwner, service, t, workspaceId]
  );

  const handleRemoveHomePage = useCallback(async () => {
    if (!service || !workspaceId) return;
    if (!isOwner) {
      notify.error(t('settings.sites.error.onlyWorkspaceOwnerCanRemoveHomepage'));
      return;
    }

    try {
      await service.removePublishHomepage(workspaceId);

      setHomePageId('');
      notify.success(t('settings.sites.success.removeHomePageSuccess'));
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
      throw e;
    }
  }, [isOwner, service, t, workspaceId]);

  const { publish, unpublish } = useAppHandlers();
  const handlePublish = useCallback(
    async (view: View, publishName: string) => {
      if (!publish) return;

      try {
        await publish(view, publishName);
        notify.success(t('publish.publishSuccessfully'));
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [publish, t]
  );

  const handleUnpublish = useCallback(
    async (viewId: string) => {
      if (!unpublish) return;

      try {
        await unpublish(viewId);
        void loadPublishPages();
        notify.success(t('publish.unpublishSuccessfully'));
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [loadPublishPages, t, unpublish]
  );

  const { getSubscriptions } = useAppHandlers();
  const [activeSubscription, setActiveSubscription] = React.useState<SubscriptionPlan | null>(null);
  const loadSubscription = useCallback(async () => {
    if (!isAppFlowyHosted()) {
      setActiveSubscription(SubscriptionPlan.Pro);
      return;
    }

    try {
      const subscriptions = await getSubscriptions?.();

      if (!subscriptions || subscriptions.length === 0) {
        setActiveSubscription(SubscriptionPlan.Free);
        return;
      }

      setActiveSubscription(getProAccessPlanFromSubscriptions(subscriptions));
    } catch (e) {
      console.error(e);
    }
  }, [getSubscriptions]);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  useEffect(() => {
    void loadPublishNamespace();
  }, [loadPublishNamespace]);

  useEffect(() => {
    if (publishViews.length === 0) return;
    void loadHomePageId();
  }, [loadHomePageId, publishViews.length]);

  useEffect(() => {
    void loadPublishPages();
  }, [loadPublishPages]);
  const url = `${window.location.origin}/${namespace}`;

  return (
    <div className={'flex flex-col gap-2'} data-testid='publish-manage-panel'>
      <div className={'px-1  text-base font-medium'}>{t('namespace')}</div>
      <div className={'px-1  text-xs text-text-secondary'}>{t('manageNamespaceDescription')}</div>
      <Divider className={'mb-2'} />
      <div className={'flex w-full items-center gap-2 px-1 text-sm font-medium'}>
        <div className={'flex-1'}>{t('namespace')}</div>
        <div className={'flex-1'}>{t('homepage')}</div>
      </div>
      <Divider className={'mb-1'} />

      <div className={'flex w-full items-center gap-2 text-sm'}>
        <div className={'flex-1 overflow-hidden'}>
          <Tooltip
            title={
              <div>
                <div>{t('shareAction.visitSite')}</div>
                <div>{url}</div>
              </div>
            }
          >
            <Button
              onClick={() => {
                void openUrl(url, '_blank');
              }}
              className={'w-full justify-start overflow-hidden'}
              color={'inherit'}
              size={'small'}
            >
              <span className={'truncate'}>
                {window.location.host}/{namespace}
              </span>
            </Button>
          </Tooltip>
        </div>
        <div className={'flex flex-1 items-center justify-between'}>
          <HomePageSetting
            activePlan={activeSubscription}
            isOwner={isOwner}
            homePage={homePage}
            publishViews={publishViews}
            onRemoveHomePage={handleRemoveHomePage}
            onUpdateHomePage={handleUpdateHomePage}
            canEdit={!uuidValidate(namespace)}
          />
          <Tooltip
            title={
              !isOwner
                ? t('settings.sites.error.onlyWorkspaceOwnerCanUpdateNamespace')
                : isAppFlowyHosted() && (activeSubscription === null || activeSubscription === SubscriptionPlan.Free)
                  ? t('settings.sites.error.onlyProCanUpdateNamespace')
                  : undefined
            }
          >
            <IconButton
              size={'small'}
              data-testid="edit-namespace-button"
              onClick={(e) => {
                // Block if not owner, or if on official host with Free/unloaded subscription
                if (!isOwner || (isAppFlowyHosted() && (activeSubscription === null || activeSubscription === SubscriptionPlan.Free))) {
                  return;
                }

                e.currentTarget.blur();
                setUpdateOpen(true);
              }}
            >
              <EditIcon />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className={'mt-4 flex items-center gap-2 px-1 text-base font-medium'}>
        {t('settings.sites.publishedPage.title')}
        {loading && <CircularProgress size={14} />}
      </div>
      <div className={'px-1  text-xs text-text-secondary'}>{t('settings.sites.publishedPage.description')}</div>
      <Divider className={'mb-2'} />
      <div className={'flex w-full items-center gap-4 px-1 text-sm font-medium'}>
        <div className={'flex-1'}>{t('settings.sites.publishedPage.page')}</div>
        <div className={'flex-1'}>
          <span className={'px-2'}>{t('settings.sites.publishedPage.pathName')}</span>
        </div>
        <div className={'flex-1'}>{t('settings.sites.publishedPage.date')}</div>
      </div>

      <Divider className={'mb-1'} />
      {loading && !publishViews.length ? (
        <PublishPagesSkeleton />
      ) : (
        <PublishedPages
          publishViews={publishViews}
          onPublish={handlePublish}
          onClose={onClose}
          onUnPublish={handleUnpublish}
          namespace={namespace}
        />
      )}

      {updateOpen && (
        <UpdateNamespace
          namespace={namespace}
          open={updateOpen}
          onClose={() => setUpdateOpen(false)}
          onUpdateNamespace={handleUpdateNamespace}
        />
      )}
    </div>
  );
}

export default PublishManage;
