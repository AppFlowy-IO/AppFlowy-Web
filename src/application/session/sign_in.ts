import { Log } from '@/utils/log';

const REDIRECT_TO_STORAGE_KEY = 'redirectTo';
const PUBLIC_FORM_REDIRECT_STORAGE_KEY = 'publicFormAuthContinuation';
const PUBLIC_FORM_AUTH_CHANNEL_NAME = 'appflowy-public-form-auth';
const PUBLIC_FORM_FLOW_ID_PATTERN = /^[a-f0-9]{32}$/;

export const PUBLIC_FORM_AUTH_FLOW_PARAM = 'formAuth';

/**
 * Public Form bearer links should survive an authentication round trip, but
 * not a later, unrelated login in the same tab.
 */
export const PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS = 15 * 60 * 1000;

interface PublicFormAuthContinuation {
  expiresAt: number;
  flowId: string;
  redirectTo: string;
  version: 1;
}

interface PublicFormAuthChannelMessage {
  flowId: string;
  type: 'authenticated';
}

let publicFormAuthChannel: BroadcastChannel | null | undefined;

export function saveRedirectTo(redirectTo: string) {
  const safeRedirectTo = getSafeRedirectUrl(redirectTo);

  if (!safeRedirectTo) {
    clearRedirectTo();
    return;
  }

  if (isPublicFormRedirectUrl(safeRedirectTo)) {
    // Authentication actions may happen near the end of the continuation
    // window. Preserve only the still-live flow instead of silently granting
    // it another full lifetime from the button click.
    const continuation = getPublicFormAuthContinuation();

    if (continuation?.redirectTo !== safeRedirectTo) clearPublicFormRedirectTo();
    return;
  }

  clearPublicFormRedirectTo();
  localStorage.setItem(REDIRECT_TO_STORAGE_KEY, safeRedirectTo);
}

export function getRedirectTo() {
  const publicFormFlowId = publicFormFlowIdFromCurrentUrl();
  const publicFormRedirectTo = getPublicFormRedirectTo();

  // A callback carrying a Form flow ID belongs only to that flow. Do not fall
  // through to a generic redirect saved by another tab when its bearer lives
  // in the originating tab's session storage.
  if (publicFormFlowId) return publicFormRedirectTo;

  // Reading a redirect from a URL outside that flow is an explicit cancel.
  clearPublicFormRedirectTo();
  const redirectTo = localStorage.getItem(REDIRECT_TO_STORAGE_KEY);

  // Older Web builds stored Form bearer paths without an expiry. Do not carry
  // those paths into a later login after upgrading.
  if (redirectTo && isPublicFormRedirectUrl(redirectTo)) {
    localStorage.removeItem(REDIRECT_TO_STORAGE_KEY);
    return null;
  }

  return redirectTo;
}

export function clearRedirectTo() {
  localStorage.removeItem(REDIRECT_TO_STORAGE_KEY);
  clearPublicFormRedirectTo();
}

function createPublicFormFlowId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicFormFlowIdFromCurrentUrl(): string | null {
  try {
    const flowId = new URL(window.location.href, window.location.origin).searchParams.get(PUBLIC_FORM_AUTH_FLOW_PARAM);

    return flowId && PUBLIC_FORM_FLOW_ID_PATTERN.test(flowId) ? flowId : null;
  } catch {
    return null;
  }
}

function readActivePublicFormAuthContinuation(now: number): PublicFormAuthContinuation | null {
  const value = sessionStorage.getItem(PUBLIC_FORM_REDIRECT_STORAGE_KEY);

  if (!value) return null;

  try {
    const continuation = JSON.parse(value) as Partial<PublicFormAuthContinuation>;
    const safeRedirectTo =
      typeof continuation.redirectTo === 'string' ? getSafeRedirectUrl(continuation.redirectTo) : null;

    if (
      continuation.version !== 1 ||
      typeof continuation.flowId !== 'string' ||
      !PUBLIC_FORM_FLOW_ID_PATTERN.test(continuation.flowId) ||
      typeof continuation.expiresAt !== 'number' ||
      !Number.isFinite(continuation.expiresAt) ||
      continuation.expiresAt <= now ||
      !safeRedirectTo ||
      !isPublicFormRedirectUrl(safeRedirectTo)
    ) {
      clearPublicFormRedirectTo();
      return null;
    }

    return {
      expiresAt: continuation.expiresAt,
      flowId: continuation.flowId,
      redirectTo: safeRedirectTo,
      version: 1,
    };
  } catch {
    clearPublicFormRedirectTo();
    return null;
  }
}

function getPublicFormAuthContinuation(now = Date.now()): PublicFormAuthContinuation | null {
  const urlFlowId = publicFormFlowIdFromCurrentUrl();

  // A stored bearer is usable only while the URL proves that this is the same
  // explicit Form authentication flow. A later plain /login is unrelated.
  if (!urlFlowId) return null;

  const continuation = readActivePublicFormAuthContinuation(now);

  if (continuation?.flowId !== urlFlowId) return null;

  ensurePublicFormAuthChannel();
  return continuation;
}

function ensurePublicFormAuthChannel() {
  if (publicFormAuthChannel !== undefined) return publicFormAuthChannel;

  if (typeof BroadcastChannel === 'undefined') {
    publicFormAuthChannel = null;
    return null;
  }

  publicFormAuthChannel = new BroadcastChannel(PUBLIC_FORM_AUTH_CHANNEL_NAME);
  publicFormAuthChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<PublicFormAuthChannelMessage> | null;

    if (message?.type !== 'authenticated' || !message.flowId || !PUBLIC_FORM_FLOW_ID_PATTERN.test(message.flowId)) {
      return;
    }

    // A stored continuation alone does not prove this tab still owns the
    // authentication flow. The user may have navigated elsewhere while a
    // magic-link callback was open in another tab.
    if (publicFormFlowIdFromCurrentUrl() !== message.flowId) return;

    const continuation = readActivePublicFormAuthContinuation(Date.now());

    if (continuation?.flowId !== message.flowId) return;

    clearPublicFormRedirectTo();
    Log.info('[Auth] public Form authentication completed in another tab');
    window.location.href = continuation.redirectTo;
  });

  return publicFormAuthChannel;
}

function notifyPublicFormAuthOrigin(flowId: string) {
  if (!PUBLIC_FORM_FLOW_ID_PATTERN.test(flowId)) return;

  ensurePublicFormAuthChannel()?.postMessage({
    flowId,
    type: 'authenticated',
  } satisfies PublicFormAuthChannelMessage);
}

function activePublicFormAuthContinuation(now = Date.now()) {
  const continuation = readActivePublicFormAuthContinuation(now);

  if (continuation) ensurePublicFormAuthChannel();
  return continuation;
}

export function savePublicFormRedirectTo(
  redirectTo: string,
  now = Date.now(),
  flowId = createPublicFormFlowId()
): string | null {
  const safeRedirectTo = getSafeRedirectUrl(redirectTo);

  if (!safeRedirectTo || !isPublicFormRedirectUrl(safeRedirectTo) || !PUBLIC_FORM_FLOW_ID_PATTERN.test(flowId)) {
    clearPublicFormRedirectTo();
    return null;
  }

  clearPublicFormRedirectTo();

  const continuation: PublicFormAuthContinuation = {
    expiresAt: now + PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS,
    flowId,
    redirectTo: safeRedirectTo,
    version: 1,
  };

  // The bearer never enters persistent storage. An auth callback opened in a
  // second tab broadcasts only this opaque flow ID back to the originating tab.
  sessionStorage.setItem(PUBLIC_FORM_REDIRECT_STORAGE_KEY, JSON.stringify(continuation));
  ensurePublicFormAuthChannel();
  return flowId;
}

export function getPublicFormRedirectTo(now = Date.now()): string | null {
  return getPublicFormAuthContinuation(now)?.redirectTo ?? null;
}

export function getPublicFormRedirectExpiresAt(now = Date.now()): number | null {
  return activePublicFormAuthContinuation(now)?.expiresAt ?? null;
}

export function clearPublicFormRedirectTo() {
  sessionStorage.removeItem(PUBLIC_FORM_REDIRECT_STORAGE_KEY);
}

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_CALLBACK_URL = `${window.location.origin}${AUTH_CALLBACK_PATH}`;

export function getAuthCallbackUrl(redirectTo: string): string {
  const callbackUrl = new URL(AUTH_CALLBACK_URL);
  const safeRedirectTo = getSafeRedirectUrl(redirectTo);
  const continuation = safeRedirectTo ? activePublicFormAuthContinuation() : null;

  if (safeRedirectTo && continuation?.redirectTo === safeRedirectTo) {
    callbackUrl.searchParams.set(PUBLIC_FORM_AUTH_FLOW_PARAM, continuation.flowId);
  }

  return callbackUrl.toString();
}

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

export function isPublicFormRedirectUrl(value: string): boolean {
  const safeRedirectTo = getSafeRedirectUrl(value);

  return safeRedirectTo ? /^\/form\/[^/]+\/?$/.test(new URL(safeRedirectTo, window.location.origin).pathname) : false;
}

/**
 * Builds an internal login URL without allowing values to alter the surrounding
 * query string. Callers must pass raw values; URLSearchParams owns the encoding.
 */
export function buildLoginUrl(params: LoginUrlParams = {}): string {
  const search = new URLSearchParams();
  const safeRedirectTo = params.redirectTo ? getSafeRedirectUrl(params.redirectTo) : null;
  const isFormContinuation = safeRedirectTo ? isPublicFormRedirectUrl(safeRedirectTo) : false;
  const formContinuation = isFormContinuation ? activePublicFormAuthContinuation() : null;
  const formFlowId =
    safeRedirectTo && formContinuation?.redirectTo === safeRedirectTo ? formContinuation.flowId : null;

  if (params.action) search.set('action', params.action);
  if (params.email) search.set('email', params.email);
  // Public Form URLs act as bearer links. Their continuation is kept in
  // guarded same-origin storage, never copied into login query strings where
  // it could reach browser history, access logs, or referrer headers.
  if (safeRedirectTo && !isFormContinuation) search.set('redirectTo', safeRedirectTo);
  if (params.type) search.set('type', params.type);
  if (params.force !== undefined || formFlowId) search.set('force', String(formFlowId ? true : params.force));
  if (formFlowId) search.set(PUBLIC_FORM_AUTH_FLOW_PARAM, formFlowId);

  const query = search.toString();

  return query ? `/login?${query}` : '/login';
}

export function afterAuth() {
  const publicFormFlowId = publicFormFlowIdFromCurrentUrl();
  const redirectTo = getRedirectTo();

  if (publicFormFlowId) {
    clearPublicFormRedirectTo();
  } else {
    clearRedirectTo();
  }

  if (redirectTo) {
    const safeRedirectTo = getSafeRedirectUrl(redirectTo);

    if (!safeRedirectTo) {
      window.location.href = '/app';
      return;
    }

    const url = new URL(safeRedirectTo, window.location.origin);
    const pathname = url.pathname;
    const logPathname = isPublicFormRedirectUrl(safeRedirectTo) ? '/form/[redacted]' : pathname;

    // Check if URL contains workspace/view UUIDs (user-specific paths)
    // Pattern matches /app/{uuid}/{uuid} or /app/{uuid}
    const hasUserSpecificIds = /\/app\/[a-f0-9-]{36}/i.test(pathname);

    if (isAuthPath(pathname)) {
      // Authentication pages are transitional destinations. Sending a newly
      // authenticated user back to one can strand them on the login screen and
      // require a second sign-in attempt.
      Log.info('[Auth] afterAuth: blocking authentication-route redirect, going to /app', { pathname: logPathname });
      window.location.href = '/app';
    } else if (hasUserSpecificIds) {
      // Don't redirect to user-specific pages from previous sessions
      Log.info('[Auth] afterAuth: blocking user-specific redirect, going to /app', { pathname: logPathname });
      window.location.href = '/app';
    } else if (pathname === '/' || !pathname) {
      // Preserve query params and hash but redirect to /app path
      url.pathname = '/app';
      Log.info('[Auth] afterAuth: root path redirect, going to /app');
      window.location.href = url.toString();
    } else {
      Log.info('[Auth] afterAuth: redirecting to saved destination', { pathname: logPathname });
      window.location.href = safeRedirectTo;
    }
  } else {
    if (publicFormFlowId) notifyPublicFormAuthOrigin(publicFormFlowId);
    Log.info('[Auth] afterAuth: no redirectTo saved, going to /app');
    window.location.href = '/app';
  }
}
