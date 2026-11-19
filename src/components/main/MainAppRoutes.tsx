import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import '@/i18n/config';
import { MCP_CONSENT_PATH } from '@/application/mcp/consentUrl';
import { MCP_SETUP_PAGE_PATH } from '@/application/mcp/setup';
import { AUTH_CALLBACK_PATH } from '@/application/session/sign_in';
import NotFound from '@/components/error/NotFound';
import withAppWrapper from '@/components/main/withAppWrapper';
import { Toaster } from '@/components/ui/sonner';
import { registerAppflowyLinkPreviewProvider } from '@/utils/link-preview-remote';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const LoginAuth = lazy(() => import('@/components/login/LoginAuth'));
const AppRouter = lazy(() => import('@/components/app/AppRouter'));
const AsTemplatePage = lazy(() => import('@/pages/AsTemplatePage'));
const AcceptInvitationPage = lazy(() => import('@/pages/AcceptInvitationPage'));
const AfterPaymentPage = lazy(() => import('@/pages/AfterPaymentPage'));
const ImportPage = lazy(() => import('@/pages/ImportPage'));
const PublishPage = lazy(() => import('@/pages/PublishPage'));
const McpAuthorizePage = lazy(() => import('@/pages/McpAuthorizePage'));
const McpSetupPage = lazy(() => import('@/pages/McpSetupPage'));

registerAppflowyLinkPreviewProvider();

const WrappedRoutes = withAppWrapper(() => {
  return (
    <Routes>
      <Route path='/:namespace/:publishName' element={<PublishPage />} />
      <Route path='/login' element={<LoginPage />} />
      <Route path={AUTH_CALLBACK_PATH} element={<LoginAuth />} />
      <Route path='/404' element={<NotFound />} />
      <Route path='/after-payment' element={<AfterPaymentPage />} />
      <Route path='/as-template' element={<AsTemplatePage />} />
      <Route path='/accept-invitation' element={<AcceptInvitationPage />} />
      <Route path='/import' element={<ImportPage />} />
      {/* MCP consent and setup live outside /app's AuthLayout; the consent page sends signed-out users to /login. */}
      {/* caseSensitive: hosts send anti-framing headers for the lowercase /oauth/ paths only (deploy/app-paths.ts). */}
      <Route path={MCP_CONSENT_PATH} element={<McpAuthorizePage />} caseSensitive />
      <Route path={MCP_SETUP_PAGE_PATH} element={<McpSetupPage />} caseSensitive />
      <Route path='/' element={<Navigate to='/app' replace />} />
      <Route path='/app/*' element={<AppRouter />} />
      <Route path='*' element={<NotFound />} />
    </Routes>
  );
});

export default function MainAppRoutes() {
  return (
    <>
      <WrappedRoutes />
      <Toaster />
    </>
  );
}
