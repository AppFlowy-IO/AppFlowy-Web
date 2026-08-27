import { Log } from '@/utils/log';

export function saveRedirectTo(redirectTo: string) {
  const safeRedirectTo = getSafeRedirectUrl(redirectTo);

  if (safeRedirectTo) {
    localStorage.setItem('redirectTo', safeRedirectTo);
  } else {
    clearRedirectTo();
  }
}

export function getRedirectTo() {
  return localStorage.getItem('redirectTo');
}

export function clearRedirectTo() {
  localStorage.removeItem('redirectTo');
}

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_CALLBACK_URL = `${window.location.origin}${AUTH_CALLBACK_PATH}`;

export function isAuthPath(pathname: string): boolean {
  let decodedPathname: string;

  try {
    // Match React Router's segment decoding while preserving encoded slashes,
    // which are data inside a segment rather than route separators.
    decodedPathname = pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    return false;
  }

  const normalizedPathname = decodedPathname.replace(/\/+$/, '').toLowerCase();

  return normalizedPathname === '/login' || normalizedPathname === AUTH_CALLBACK_PATH;
}

const MAX_REDIRECT_VALIDATION_DECODES = 5;
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const AUTHORITY_RELATIVE_URL_PATTERN = /^[\\/]{2}/;

export interface LoginUrlParams {
  action?: string;
  email?: string;
  force?: boolean;
  redirectTo?: string;
  type?: string;
}

export function withSignIn() {
  return function (
    // eslint-disable-next-line
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
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

/**
 * Returns the original redirect value only when every valid decoding layer
 * remains a root-relative or same-origin URL. The value itself is deliberately
 * not decoded: URLSearchParams already decodes query values, and decoding again
 * can turn data such as "%2F%5Cevil.com" into an external redirect.
 */
export function getSafeRedirectUrl(value: string): string | null {
  if (!value) return null;

  let candidate = value;

  for (let decodeCount = 0; decodeCount <= MAX_REDIRECT_VALIDATION_DECODES; decodeCount += 1) {
    const isRootRelative = candidate.startsWith('/') && !AUTHORITY_RELATIVE_URL_PATTERN.test(candidate);
    const isAbsolute = ABSOLUTE_URL_PATTERN.test(candidate);

    if (!isRootRelative && !isAbsolute) return null;

    try {
      const parsed = new URL(candidate, window.location.origin);

      if (parsed.origin !== window.location.origin) return null;
    } catch {
      return null;
    }

    let decoded: string;

    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      // The redirect is never decoded for navigation. If another decoding pass
      // is not valid, the already-parsed same-origin value cannot become an
      // authority URL through that pass.
      return value;
    }

    if (decoded === candidate) return value;

    candidate = decoded;
  }

  // Reject unusually deep encodings instead of guessing how another layer may
  // interpret them later.
  return null;
}

export function isSafeRedirectUrl(url: string): boolean {
  return getSafeRedirectUrl(url) !== null;
}

/**
 * Builds an internal login URL without allowing values to alter the surrounding
 * query string. Callers must pass raw values; URLSearchParams owns the encoding.
 */
export function buildLoginUrl(params: LoginUrlParams = {}): string {
  const search = new URLSearchParams();
  const safeRedirectTo = params.redirectTo ? getSafeRedirectUrl(params.redirectTo) : null;

  if (params.action) search.set('action', params.action);
  if (params.email) search.set('email', params.email);
  if (safeRedirectTo) search.set('redirectTo', safeRedirectTo);
  if (params.type) search.set('type', params.type);
  if (params.force !== undefined) search.set('force', String(params.force));

  const query = search.toString();

  return query ? `/login?${query}` : '/login';
}

export function afterAuth() {
  const redirectTo = getRedirectTo();

  clearRedirectTo();

  if (redirectTo) {
    const safeRedirectTo = getSafeRedirectUrl(redirectTo);

    if (!safeRedirectTo) {
      window.location.href = '/app';
      return;
    }

    const url = new URL(safeRedirectTo, window.location.origin);
    const pathname = url.pathname;

    // Check if URL contains workspace/view UUIDs (user-specific paths)
    // Pattern matches /app/{uuid}/{uuid} or /app/{uuid}
    const hasUserSpecificIds = /\/app\/[a-f0-9-]{36}/i.test(pathname);

    if (isAuthPath(pathname)) {
      // Authentication pages are transitional destinations. Sending a newly
      // authenticated user back to one can strand them on the login screen and
      // require a second sign-in attempt.
      Log.info('[Auth] afterAuth: blocking authentication-route redirect, going to /app', { pathname });
      window.location.href = '/app';
    } else if (hasUserSpecificIds) {
      // Don't redirect to user-specific pages from previous sessions
      Log.info('[Auth] afterAuth: blocking user-specific redirect, going to /app', { pathname });
      window.location.href = '/app';
    } else if (pathname === '/' || !pathname) {
      // Preserve query params and hash but redirect to /app path
      url.pathname = '/app';
      Log.info('[Auth] afterAuth: root path redirect, going to /app');
      window.location.href = url.toString();
    } else {
      Log.info('[Auth] afterAuth: redirecting to saved destination', { pathname });
      window.location.href = safeRedirectTo;
    }
  } else {
    Log.info('[Auth] afterAuth: no redirectTo saved, going to /app');
    window.location.href = '/app';
  }
}
