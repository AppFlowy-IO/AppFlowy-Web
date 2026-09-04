import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  clearRedirectTo,
  getPublicFormRedirectExpiresAt,
  getPublicFormRedirectTo,
  getRedirectTo,
  getSafeRedirectUrl,
  isPublicFormRedirectUrl,
  PUBLIC_FORM_AUTH_FLOW_PARAM,
  savePublicFormRedirectTo,
  saveRedirectTo,
} from '@/application/session/sign_in';
import { Login } from '@/components/login';
import { ChangePassword } from '@/components/login/ChangePassword';
import CheckEmail from '@/components/login/CheckEmail';
import CheckEmailResetPassword from '@/components/login/CheckEmailResetPassword';
import { LOGIN_ACTION } from '@/components/login/const';
import { EnterPassword } from '@/components/login/EnterPassword';
import { ForgotPassword } from '@/components/login/ForgotPassword';
import { SignUpPassword } from '@/components/login/SignUpPassword';
import { useIsAuthenticatedOptional } from '@/components/main/app.hooks';

function LoginPage() {
  const [search, setSearch] = useSearchParams();
  const action = search.get('action') || '';
  const email = search.get('email') || '';
  const force = search.get('force') === 'true';
  const redirectToParam = search.get('redirectTo');
  const redirectTo = redirectToParam || '';
  const type = search.get('type') || '';
  const isAuthenticated = useIsAuthenticatedOptional();
  const [storedRedirectTo, setStoredRedirectTo] = useState(() => getRedirectTo() || '');
  const safeQueryRedirectTo = useMemo(() => getSafeRedirectUrl(redirectTo) || '', [redirectTo]);
  const safeStoredRedirectTo = useMemo(() => getSafeRedirectUrl(storedRedirectTo) || '', [storedRedirectTo]);
  const safeRedirectTo = redirectToParam !== null ? safeQueryRedirectTo : safeStoredRedirectTo;

  // Legacy Form login links may still carry the bearer as `redirectTo`.
  // Move it into guarded storage and replace the URL. Unsafe explicit values
  // also take precedence over (and clear) stale stored continuations.
  useEffect(() => {
    if (redirectToParam === null) return;

    if (safeQueryRedirectTo && !isPublicFormRedirectUrl(safeQueryRedirectTo)) {
      // An explicit non-Form destination starts a separate login flow and
      // cancels any abandoned Form continuation in this tab.
      saveRedirectTo(safeQueryRedirectTo);
      return;
    }

    const publicFormFlowId = safeQueryRedirectTo ? savePublicFormRedirectTo(safeQueryRedirectTo) : null;

    if (safeQueryRedirectTo && publicFormFlowId) {
      setStoredRedirectTo(safeQueryRedirectTo);
    } else {
      clearRedirectTo();
      setStoredRedirectTo('');
    }

    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);

        next.delete('redirectTo');
        if (publicFormFlowId) {
          next.set('force', 'true');
          next.set(PUBLIC_FORM_AUTH_FLOW_PARAM, publicFormFlowId);
        }

        return next;
      },
      { replace: true }
    );
  }, [redirectToParam, safeQueryRedirectTo, setSearch]);

  // A continuation captured before entering the token-free login flow is
  // still untrusted browser storage. Drop it if it no longer passes the same
  // redirect validation used for query parameters.
  useEffect(() => {
    if (storedRedirectTo && !safeStoredRedirectTo) {
      clearRedirectTo();
    }
  }, [safeStoredRedirectTo, storedRedirectTo]);

  useEffect(() => {
    if (!isPublicFormRedirectUrl(safeStoredRedirectTo)) return;

    const expiresAt = getPublicFormRedirectExpiresAt();

    if (!expiresAt) {
      setStoredRedirectTo('');
      return;
    }

    const timeout = window.setTimeout(() => {
      if (!getPublicFormRedirectTo()) setStoredRedirectTo('');
    }, Math.max(0, expiresAt - Date.now()) + 1);

    return () => window.clearTimeout(timeout);
  }, [safeStoredRedirectTo]);

  useEffect(() => {
    if (action === LOGIN_ACTION.CHANGE_PASSWORD || force) {
      return;
    }

    if (isAuthenticated && safeRedirectTo && safeRedirectTo !== window.location.href) {
      clearRedirectTo();
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
