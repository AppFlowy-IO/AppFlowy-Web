import React, { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { UIVariant } from '@/application/types';
import { ErrorType } from '@/application/utils/error-utils';
import { AFScroller } from '@/components/_shared/scroller';
import { useAppViewId, useViewErrorStatus } from '@/components/app/app.hooks';
import Main from '@/components/app/Main';
import DeletedPageComponent from '@/components/error/PageHasBeenDeleted';
import RecordNotFound from '@/components/error/RecordNotFound';
import SomethingError from '@/components/error/SomethingError';

const MobileTopBar = React.lazy(() => import('@/components/_shared/mobile-topbar/MobileTopBar'));

function MobileMainLayout() {
  const viewId = useAppViewId();
  const { notFound, deleted, noAccess } = useViewErrorStatus();
  const { t } = useTranslation();

  const main = useMemo(() => {
    if (deleted) {
      return <DeletedPageComponent />;
    }

    if (noAccess) {
      return (
        <RecordNotFound
          viewId={viewId}
          error={{ type: ErrorType.Forbidden, message: t('requestAccess.title') }}
        />
      );
    }

    return notFound ? <RecordNotFound isViewNotFound /> : <Main />;
  }, [deleted, noAccess, notFound, t, viewId]);

  return (
    <div className={'h-screen w-screen'}>
      <AFScroller
        overflowXHidden
        overflowYHidden={false}
        className={'appflowy-layout appflowy-mobile-layout flex flex-col appflowy-scroll-container h-full'}
      >
        <React.Suspense
          fallback={
            <div className={'flex items-center justify-between w-full h-[48px] min-h-[48px] px-4 gap-2'} />}
        >
          <MobileTopBar variant={UIVariant.App} />
        </React.Suspense>

        <ErrorBoundary FallbackComponent={SomethingError}>
          {main}
        </ErrorBoundary>

      </AFScroller>

    </div>
  );
}

export default MobileMainLayout;
