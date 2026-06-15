import { memo } from 'react';

import { AppProvider } from '@/components/app/app.hooks';
import MainLayout from '@/components/app/MainLayout';
import MobileMainLayout from '@/components/app/MobileMainLayout';
import { getPlatform } from '@/utils/platform';

export function AuthLayout () {
  const isMobile = getPlatform().isMobile;

  return (
    <AppProvider>
      {isMobile ? <MobileMainLayout /> : <MainLayout />}
    </AppProvider>
  );
}

export default memo(AuthLayout);