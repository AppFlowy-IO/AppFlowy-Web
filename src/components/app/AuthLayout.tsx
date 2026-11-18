import { memo } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

import { AppProvider } from '@/components/app/AppProvider';
import MainLayout from '@/components/app/MainLayout';
import MobileMainLayout from '@/components/app/MobileMainLayout';
import { getPlatform } from '@/utils/platform';
import { normalizeAppRouteId } from '@/utils/url';

export function AuthLayout () {
  const { workspaceId, viewId } = useParams();
  const { pathname, search, hash, state } = useLocation();

  if (workspaceId) {
    const workspace = normalizeAppRouteId(workspaceId);
    const view = viewId && normalizeAppRouteId(viewId);

    if (!workspace || (viewId && !view)) return <Navigate to='/404' replace />;

    const canonicalPath = view ? `/app/${workspace}/${view}` : `/app/${workspace}`;

    if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
      return <Navigate to={{ pathname: canonicalPath, search, hash }} state={state} replace />;
    }
  }

  const isMobile = getPlatform().isMobile;

  return (
    <AppProvider>
      {isMobile ? <MobileMainLayout /> : <MainLayout />}
    </AppProvider>
  );
}

export default memo(AuthLayout);
