import { memo } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { AppProvider } from '@/components/app/AppProvider';
import MainLayout from '@/components/app/MainLayout';
import MobileMainLayout from '@/components/app/MobileMainLayout';
import { getPlatform } from '@/utils/platform';
import { isWorkspaceRouteId } from '@/utils/url';

export function AuthLayout () {
  const { workspaceId } = useParams();

  if (workspaceId && !isWorkspaceRouteId(workspaceId)) {
    return <Navigate to='/404' replace />;
  }

  const isMobile = getPlatform().isMobile;

  return (
    <AppProvider>
      {isMobile ? <MobileMainLayout /> : <MainLayout />}
    </AppProvider>
  );
}

export default memo(AuthLayout);
