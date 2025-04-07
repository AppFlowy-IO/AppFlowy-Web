import CheckEmail from '@/components/login/CheckEmail';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Login } from '@/components/login';
import React, { useContext, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

function LoginPage () {
  const [search] = useSearchParams();
  const redirectTo = search.get('redirectTo') || '';
  const action = search.get('action') || '';
  const email = search.get('email') || '';
  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated || false;

  useEffect(() => {
    if (isAuthenticated && redirectTo && decodeURIComponent(redirectTo) !== window.location.href) {
      window.location.href = decodeURIComponent(redirectTo);
    }
  }, [isAuthenticated, redirectTo]);
  return (
    <div className={'bg-background-primary flex h-screen w-screen items-center justify-center'}>
      {action === 'checkEmail' ? (
        <CheckEmail
          email={email}
          redirectTo={redirectTo}
        />
      ) : <Login redirectTo={redirectTo} />}

    </div>
  );
}

export default LoginPage;
