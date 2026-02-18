import { useContext, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Login } from '@/components/login';
import { ChangePassword } from '@/components/login/ChangePassword';
import CheckEmail from '@/components/login/CheckEmail';
import CheckEmailResetPassword from '@/components/login/CheckEmailResetPassword';
import { LOGIN_ACTION } from '@/components/login/const';
import { EnterPassword } from '@/components/login/EnterPassword';
import { ForgotPassword } from '@/components/login/ForgotPassword';
import { SignUpPassword } from '@/components/login/SignUpPassword';
import { AFConfigContext } from '@/components/main/app.hooks';

function LoginPage() {
  const [search] = useSearchParams();
  const action = search.get('action') || '';
  const email = search.get('email') || '';
  const force = search.get('force') === 'true';
  const redirectTo = search.get('redirectTo') || '';
  const type = search.get('type') || '';
  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated || false;


  useEffect(() => {
    if (action === LOGIN_ACTION.CHANGE_PASSWORD || force) {
      return;
    }

    if (isAuthenticated && redirectTo) {
      const decodedRedirect = decodeURIComponent(redirectTo);

      if (decodedRedirect !== window.location.href) {
        window.location.href = decodedRedirect;
      }
    }
  }, [action, force, isAuthenticated, redirectTo]);

  const renderContent = useMemo(() => {
    switch (action) {
      case LOGIN_ACTION.CHECK_EMAIL:
        return <CheckEmail email={email} redirectTo={redirectTo} otpType={type === 'signup' ? 'signup' : undefined} />;
      case LOGIN_ACTION.ENTER_PASSWORD:
        return <EnterPassword email={email} redirectTo={redirectTo} />;
      case LOGIN_ACTION.RESET_PASSWORD:
        return <ForgotPassword email={email} redirectTo={redirectTo} />;
      case LOGIN_ACTION.CHECK_EMAIL_RESET_PASSWORD:
        return <CheckEmailResetPassword email={email} redirectTo={redirectTo} />;
      case LOGIN_ACTION.CHANGE_PASSWORD:
        return <ChangePassword email={email} redirectTo={redirectTo} />;
      case LOGIN_ACTION.SIGN_UP_PASSWORD:
        return <SignUpPassword redirectTo={redirectTo} />;
      default:
        return <Login redirectTo={redirectTo} />;
    }
  }, [action, email, redirectTo, type]);

  return (
    <div className={'flex h-screen w-screen items-center justify-center bg-background-primary'}>{renderContent}</div>
  );
}

export default LoginPage;
