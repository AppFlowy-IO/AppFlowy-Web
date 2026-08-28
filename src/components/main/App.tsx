import { AUTH_CALLBACK_PATH } from '@/application/session/sign_in';
import NotFound from '@/components/error/NotFound';
import withAppWrapper from '@/components/main/withAppWrapper';

import '@/styles/app.scss';
import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Toaster } from '../ui/sonner';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const LoginAuth = lazy(() => import('@/components/login/LoginAuth'));
const AppRouter = lazy(() => import('@/components/app/AppRouter'));
const AsTemplatePage = lazy(() => import('@/pages/AsTemplatePage'));
const AcceptInvitationPage = lazy(() => import('@/pages/AcceptInvitationPage'));
const AfterPaymentPage = lazy(() => import('@/pages/AfterPaymentPage'));
const ImportPage = lazy(() => import('@/pages/ImportPage'));
const PublishPage = lazy(() => import('@/pages/PublishPage'));
const FormPage = lazy(() => import('@/pages/FormPage'));

const AppMain = withAppWrapper(() => {
  return (
    <Routes>
      <Route path={'/:namespace/:publishName'} element={<PublishPage />} />
      <Route path={'/login'} element={<LoginPage />} />
      <Route path={AUTH_CALLBACK_PATH} element={<LoginAuth />} />
      <Route path='/404' element={<NotFound />} />
      <Route path='/after-payment' element={<AfterPaymentPage />} />
      <Route path='/as-template' element={<AsTemplatePage />} />
      <Route path='/accept-invitation' element={<AcceptInvitationPage />} />
      <Route path={'/import'} element={<ImportPage />} />
      <Route path={'/form/:token'} element={<FormPage />} />
      <Route path='/' element={<Navigate to='/app' replace />} />
      <Route path='/app/*' element={<AppRouter />} />
      <Route path='*' element={<NotFound />} />
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
