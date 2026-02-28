import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UIVariant } from '@/application/types';
import { ReactComponent as PrivateSpaceIcon } from '@/assets/icons/private-space.svg';
import { ReactComponent as ShareIcon } from '@/assets/icons/share-to.svg';
import { ReactComponent as TeamIcon } from '@/assets/icons/team.svg';
import { AccessService } from '@/application/services/domains';
import { BreadcrumbProps } from '@/components/_shared/breadcrumb/Breadcrumb';
import BreadcrumbSkeleton from '@/components/_shared/skeleton/BreadcrumbSkeleton';
import { useAppHandlers, useBreadcrumb, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Progress } from '@/components/ui/progress';

export function withAppBreadcrumb (Component: React.ComponentType<BreadcrumbProps>) {
  return function AppBreadcrumbComponent () {
    const isTrash = window.location.pathname === '/app/trash';
    const crumbs = useBreadcrumb();
    const toView = useAppHandlers().toView;
    const currentWorkspaceId = useCurrentWorkspaceId();
    const currentUser = useCurrentUser();
    const { t } = useTranslation();
    const [isShared, setIsShared] = useState(false);
    const [loading, setLoading] = useState(false);

    const isPrivate = crumbs?.some((crumb) => crumb.is_private);

    useEffect(() => {
      if (!currentWorkspaceId || !currentUser || !crumbs || isTrash) return;
      const loadShareDetail = async () => {
        const viewId = crumbs[crumbs.length - 1].view_id;
        const ancestorViewIds = crumbs.map((crumb) => crumb.view_id);

        try {
          setLoading(true);
          const res = await AccessService.getShareDetail(currentWorkspaceId, viewId, ancestorViewIds);
          const shared = res.shared_with.some((item) => item.email !== currentUser.email);

          setIsShared(shared);
        } catch (error) {
          setIsShared(false);
        } finally {
          setLoading(false);
        }
      };

      void loadShareDetail();
    }, [currentWorkspaceId, currentUser, crumbs, isTrash]);

    return (
      <div className={'h-full flex-1 overflow-hidden'}>
        {!crumbs ? <BreadcrumbSkeleton /> :
          !isTrash && (
            <div className={'relative flex h-full w-full flex-1 items-center gap-2 overflow-hidden'}>
              <Component
                toView={toView}
                crumbs={crumbs}
                variant={UIVariant.App}
              />
              {!isPrivate && (
                <div className='ml-2 flex items-center gap-1 text-xs font-medium text-text-tertiary'>
                  <TeamIcon className='h-5 w-5 shrink-0 text-icon-tertiary' />
                  {t('teamSpace')}
                </div>
              )}
              {isPrivate && (
                <div className='ml-2 flex items-center gap-1 text-xs font-medium text-text-tertiary'>
                  {loading && <Progress variant={'primary'} />}
                  {isShared ? (
                    <>
                      <ShareIcon className='h-5 w-5 shrink-0 text-icon-tertiary' />
                      {t('share')}
                    </>
                  ) : (
                    <>
                      <PrivateSpaceIcon className='h-5 w-5 shrink-0 text-icon-tertiary' />
                      {t('private')}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        }
      </div>
    );
  };
}
