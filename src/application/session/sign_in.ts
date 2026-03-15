import { Log } from '@/utils/log';

export function saveRedirectTo(redirectTo: string) {
  localStorage.setItem('redirectTo', redirectTo);
}

export function getRedirectTo() {
  return localStorage.getItem('redirectTo');
}

export function clearRedirectTo() {
  localStorage.removeItem('redirectTo');
}

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_CALLBACK_URL = `${window.location.origin}${AUTH_CALLBACK_PATH}`;

export function withSignIn() {
  return function (
    // eslint-disable-next-line
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    // eslint-disable-next-line
    descriptor.value = async function (args: { redirectTo: string }) {
      const redirectTo = args.redirectTo;

      saveRedirectTo(redirectTo);

      try {
        await originalMethod.apply(this, [args]);
      } catch (e) {
        console.error(e);
        return Promise.reject(e);
      }
    };

    return descriptor;
  };
}

export function afterAuth() {
  const redirectTo = getRedirectTo();

  clearRedirectTo();

  if (redirectTo) {
    const url = new URL(decodeURIComponent(redirectTo));
    const pathname = url.pathname;

    // Check if URL contains workspace/view UUIDs (user-specific paths)
    // Pattern matches /app/{uuid}/{uuid} or /app/{uuid}
    const hasUserSpecificIds = /\/app\/[a-f0-9-]{36}/.test(pathname);

    if (hasUserSpecificIds) {
      // Don't redirect to user-specific pages from previous sessions
      Log.info('[Auth] afterAuth: blocking user-specific redirect, going to /app', { pathname });
      window.location.href = '/app';
    } else if (pathname === '/' || !pathname) {
      url.pathname = '/app';
      Log.info('[Auth] afterAuth: root path redirect, going to /app');
      window.location.href = url.toString();
    } else {
      Log.info('[Auth] afterAuth: redirecting to saved destination', { pathname });
      window.location.href = url.toString();
    }
  } else {
    Log.info('[Auth] afterAuth: no redirectTo saved, going to /app');
    window.location.href = '/app';
  }
}
