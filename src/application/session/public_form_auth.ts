import { buildLoginUrl, savePublicFormRedirectTo } from '@/application/session/sign_in';
import { LOGIN_ACTION } from '@/components/login/const';

export type PublicFormAuthMode = 'login' | 'signUp';

export function getPublicFormAuthUrl(mode: PublicFormAuthMode, redirectTo?: string): string {
  return buildLoginUrl({
    ...(mode === 'signUp' ? { action: LOGIN_ACTION.SIGN_UP_PASSWORD } : {}),
    // The Form endpoint can reject a locally cached session. Keep the login
    // page visible instead of immediately forwarding that same session back
    // to the Form in a loop.
    force: true,
    redirectTo,
  });
}

export function beginPublicFormAuthentication(
  token: string,
  mode: PublicFormAuthMode,
  navigate: (url: string) => void = (url) => window.location.assign(url)
) {
  const redirectTo = `/form/${encodeURIComponent(token)}`;

  // Store the continuation behind an expiring opaque flow ID so the Form
  // bearer never appears in a login URL or leaks into a later login flow.
  savePublicFormRedirectTo(redirectTo);

  // The current Form URL is the referrer for a hard navigation. Replace the
  // history entry first so the bearer path cannot be emitted as Referer.
  if (isPublicFormPage(window.location.href)) {
    window.history.replaceState(window.history.state, '', '/form');
  }

  navigate(getPublicFormAuthUrl(mode, redirectTo));
}

function isPublicFormPage(value: string) {
  try {
    return /^\/form\/[^/]+\/?$/.test(new URL(value, window.location.origin).pathname);
  } catch {
    return false;
  }
}
