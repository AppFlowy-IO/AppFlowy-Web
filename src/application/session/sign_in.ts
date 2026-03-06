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

export function afterAuth() {
  const redirectTo = getRedirectTo();

  clearRedirectTo();

  if (redirectTo) {
    const decoded = safeDecodeRedirectParam(redirectTo);

    if (!decoded || !isSafeRedirectUrl(decoded)) {
      window.location.href = '/app';
      return;
    }

    const url = new URL(decoded, window.location.origin);
    const pathname = url.pathname;

    // Check if URL contains workspace/view UUIDs (user-specific paths)
    // Pattern matches /app/{uuid}/{uuid} or /app/{uuid}
    const hasUserSpecificIds = /\/app\/[a-f0-9-]{36}/.test(pathname);

    if (hasUserSpecificIds) {
      // Don't redirect to user-specific pages from previous sessions
      window.location.href = '/app';
    } else if (pathname === '/' || !pathname) {
      // Preserve query params and hash but redirect to /app path
      url.pathname = '/app';
      window.location.href = url.toString();
    } else {
      window.location.href = decoded;
    }
  } else {
    window.location.href = '/app';
  }
}
