import { Route, Routes } from 'react-router-dom';

import AppWorkspaceRedirect from '@/components/app/AppWorkspaceRedirect';
import { AuthLayout } from '@/components/app/AuthLayout';
import { ApproveConversion } from '@/components/app/landing-pages/ApproveConversion';
import ApproveRequestPage from '@/components/app/landing-pages/ApproveRequestPage';
import { AsGuest } from '@/components/app/landing-pages/AsGuest';
import InviteCode from '@/components/app/landing-pages/InviteCode';
import AppPage from '@/pages/AppPage';
import TrashPage from '@/pages/TrashPage';

function AppRouter() {
  return (
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
  );
}

export default AppRouter;
