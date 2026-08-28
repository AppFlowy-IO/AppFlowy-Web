import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Login } from '@/components/login';
import { ChangePassword } from '@/components/login/ChangePassword';
import CheckEmail from '@/components/login/CheckEmail';
import CheckEmailResetPassword from '@/components/login/CheckEmailResetPassword';
import { LOGIN_ACTION } from '@/components/login/const';
import { EnterPassword } from '@/components/login/EnterPassword';
import { ForgotPassword } from '@/components/login/ForgotPassword';
import { SignUpPassword } from '@/components/login/SignUpPassword';
import { getSafeRedirectUrl } from '@/application/session/sign_in';
import { useIsAuthenticatedOptional } from '@/components/main/app.hooks';

function LoginPage() {
  const [search, setSearch] = useSearchParams();
  const action = search.get('action') || '';
  const email = search.get('email') || '';
  const force = search.get('force') === 'true';
  const redirectTo = search.get('redirectTo') || '';
  const type = search.get('type') || '';
  const isAuthenticated = useIsAuthenticatedOptional();
  const safeRedirectTo = useMemo(() => getSafeRedirectUrl(redirectTo) || '', [redirectTo]);

  // Strip unsafe redirectTo from URL immediately, preserving all other params
  useEffect(() => {
    if (!redirectTo) return;

    if (!safeRedirectTo) {
      setSearch((prev) => {
        const next = new URLSearchParams(prev);

        next.delete('redirectTo');
        return next;
      });
    }
  }, [redirectTo, safeRedirectTo, setSearch]);

  useEffect(() => {
    if (action === LOGIN_ACTION.CHANGE_PASSWORD || force) {
      return;
    }

    if (isAuthenticated && safeRedirectTo && safeRedirectTo !== window.location.href) {
      window.location.href = safeRedirectTo;
    }
  }, [action, force, isAuthenticated, safeRedirectTo]);

  const renderContent = useMemo(() => {
    switch (action) {
      case LOGIN_ACTION.CHECK_EMAIL:
        return (
          <CheckEmail email={email} redirectTo={safeRedirectTo} otpType={type === 'signup' ? 'signup' : undefined} />
        );
      case LOGIN_ACTION.ENTER_PASSWORD:
        return <EnterPassword email={email} redirectTo={safeRedirectTo} />;
      case LOGIN_ACTION.RESET_PASSWORD:
        return <ForgotPassword email={email} redirectTo={safeRedirectTo} />;
      case LOGIN_ACTION.CHECK_EMAIL_RESET_PASSWORD:
        return <CheckEmailResetPassword email={email} redirectTo={safeRedirectTo} />;
      case LOGIN_ACTION.CHANGE_PASSWORD:
        return <ChangePassword email={email} redirectTo={safeRedirectTo} />;
      case LOGIN_ACTION.SIGN_UP_PASSWORD:
        return <SignUpPassword redirectTo={safeRedirectTo} />;
      default:
        return <Login redirectTo={safeRedirectTo} />;
    }
  }, [action, email, safeRedirectTo, type]);

  return (
    <div className={'flex h-screen w-screen items-center justify-center bg-background-primary'}>{renderContent}</div>
  );
}

export default LoginPage;
