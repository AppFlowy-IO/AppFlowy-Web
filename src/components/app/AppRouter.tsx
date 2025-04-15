import { AuthLayout } from '@/components/app/AuthLayout';
import ApproveRequestPage from '@/components/app/landing-pages/ApproveRequestPage';
import InviteCode from '@/components/app/landing-pages/InviteCode';
import RecordNotFound from '@/components/error/RecordNotFound';
import AppPage from '@/pages/AppPage';
import TrashPage from '@/pages/TrashPage';
import React from 'react';
import { Route, Routes } from 'react-router-dom';

function AppRouter () {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route
          index
          element={<RecordNotFound noContent />}
        />
        <Route
          path={':workspaceId'}
          element={<AppPage />}
        />
        <Route
          path={':workspaceId/:viewId'}
          element={<AppPage />}
        />
        <Route
          path={'trash'}
          element={<TrashPage />}
        />

      </Route>
      <Route
        path={'invited/:code'}
        element={<InviteCode />}
      />
      <Route
        path={'approve-request'}
        element={<ApproveRequestPage />}
      />
    </Routes>
  );
}

export default AppRouter;