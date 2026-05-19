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

/**
 * Decodes a percent-encoded redirect parameter, returning null on malformed input
 * so that bad values are always treated as unsafe rather than crashing.
 */
export function safeDecodeRedirectParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Returns true only if the URL is safe to redirect to after authentication.
 * Safe means: a relative path (starts with "/" but NOT "//") OR
 * an absolute URL whose origin matches window.location.origin.
 */
export function isSafeRedirectUrl(url: string): boolean {
  if (!url) return false;

  // Relative path — safe (but "//evil.com" is protocol-relative, not safe)
  if (url.startsWith('/') && !url.startsWith('//')) {
    return true;
  }

  // Absolute URL — only safe if same origin
  try {
    const parsed = new URL(url);

    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Resolve the value stored by login flows without decoding already-safe relative
 * URLs. OAuth handoffs can contain nested, percent-encoded query values; decoding
 * those before navigation can turn encoded "&" characters into real separators.
 */
export function resolveStoredRedirectUrl(value: string): string | null {
  if (isSafeRedirectUrl(value)) {
    return value;
  }

  const decoded = safeDecodeRedirectParam(value);

  if (decoded && isSafeRedirectUrl(decoded)) {
    return decoded;
  }

  return null;
}

export function afterAuth() {
  const redirectTo = getRedirectTo();

  clearRedirectTo();

  if (redirectTo) {
    const resolved = resolveStoredRedirectUrl(redirectTo);

    if (!resolved) {
      window.location.href = '/app';
      return;
    }

    const url = new URL(resolved, window.location.origin);
    const pathname = url.pathname;

    // Check if URL contains workspace/view UUIDs (user-specific paths)
    // Pattern matches /app/{uuid}/{uuid} or /app/{uuid}
    const hasUserSpecificIds = /\/app\/[a-f0-9-]{36}/.test(pathname);

    if (hasUserSpecificIds) {
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
      window.location.href = resolved;
    }
  } else {
    Log.info('[Auth] afterAuth: no redirectTo saved, going to /app');
    window.location.href = '/app';
  }
}
