import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import AppWorkspaceRedirect from '@/components/app/AppWorkspaceRedirect';
import { AuthLayout } from '@/components/app/AuthLayout';

// Lazy-load heavy pages to reduce initial bundle size
// Landing pages and trash are infrequently visited — defer their load
const ApproveConversion = lazy(() =>
  import('@/components/app/landing-pages/ApproveConversion').then(m => ({ default: m.ApproveConversion }))
);
const ApproveRequestPage = lazy(() => import('@/components/app/landing-pages/ApproveRequestPage'));
const AsGuest = lazy(() =>
  import('@/components/app/landing-pages/AsGuest').then(m => ({ default: m.AsGuest }))
);
const InviteCode = lazy(() => import('@/components/app/landing-pages/InviteCode'));
const AppPage = lazy(() => import('@/pages/AppPage'));
const TrashPage = lazy(() => import('@/pages/TrashPage'));

function AppRouter() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<AuthLayout />}>
          {/* Redirect from /app to /app/:workspaceId after OAuth login */}
          <Route index element={<AppWorkspaceRedirect />} />
          <Route path={':workspaceId'} element={<AppPage />} />
          <Route path={':workspaceId/:viewId'} element={<AppPage />} />
          <Route path={'trash'} element={<TrashPage />} />
        </Route>
        <Route path={'invited/:code'} element={<InviteCode />} />
        <Route path={'accept-guest-invitation'} element={<AsGuest />} />
        <Route path={'approve-guest-conversion'} element={<ApproveConversion />} />
        <Route path={'approve-request'} element={<ApproveRequestPage />} />
      </Routes>
    </Suspense>
  );
}

export default AppRouter;
