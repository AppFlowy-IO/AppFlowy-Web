import { AUTH_CALLBACK_PATH } from '@/application/session/sign_in';
import NotFound from '@/components/error/NotFound';
import LoginAuth from '@/components/login/LoginAuth';
import withAppWrapper from '@/components/main/withAppWrapper';

import '@/styles/app.scss';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Toaster } from '../ui/sonner';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const AppRouter = lazy(() => import('@/components/app/AppRouter'));
const AsTemplatePage = lazy(() => import('@/pages/AsTemplatePage'));
const AcceptInvitationPage = lazy(() => import('@/pages/AcceptInvitationPage'));
const AfterPaymentPage = lazy(() => import('@/pages/AfterPaymentPage'));
const ImportPage = lazy(() => import('@/pages/ImportPage'));
const PublishPage = lazy(() => import('@/pages/PublishPage'));
const MCPAuthorizePage = lazy(() => import('@/pages/MCPAuthorizePage'));

const AppMain = withAppWrapper(() => {
  return (
    <Routes>
      <Route
        path={'/:namespace/:publishName'}
        element={
          <Suspense>
            <PublishPage />
          </Suspense>
        }
      />
      <Route
        path={'/login'}
        element={<Suspense><LoginPage /></Suspense>}
      />
      <Route
        path={'/oauth/mcp/authorize'}
        element={<Suspense><MCPAuthorizePage /></Suspense>}
      />
      <Route
        path={AUTH_CALLBACK_PATH}
        element={<LoginAuth />}
      />
      <Route
        path="/404"
        element={<NotFound />}
      />
      <Route
        path="/after-payment"
        element={<Suspense><AfterPaymentPage /></Suspense>}
      />
      <Route
        path="/as-template"
        element={<Suspense><AsTemplatePage /></Suspense>}
      />
      <Route
        path="/accept-invitation"
        element={<Suspense><AcceptInvitationPage /></Suspense>}
      />
      <Route
        path={'/import'}
        element={<Suspense><ImportPage /></Suspense>}
      />
      <Route
        path="/"
        element={<Navigate
          to="/app"
          replace
        />}
      />
      <Route
        path="/app/*"
        element={
          <Suspense>
            <AppRouter />
          </Suspense>
        }
      />
      <Route
        path="*"
        element={<NotFound />}
      />
    </Routes>
  );
});

function App() {

  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AppMain />
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
