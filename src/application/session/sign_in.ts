import { Log } from '@/utils/log';

const REDIRECT_TO_STORAGE_KEY = 'redirectTo';
const AUTH_FLOW_ID_PATTERN = /^[a-f0-9]{32}$/;

export const PUBLIC_FORM_AUTH_FLOW_PARAM = 'formAuth';

/**
 * Public Form bearer links should survive an authentication round trip, but
 * not a later, unrelated login in the same tab.
 */
export const PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS = 15 * 60 * 1000;

/** The MCP OAuth consent page (`src/pages/McpAuthorizePage.tsx`). */
export const MCP_CONSENT_PATH = '/oauth/mcp/authorize';

export const MCP_CONSENT_AUTH_FLOW_PARAM = 'mcpAuth';

/**
 * An MCP consent request survives sign-in only while the MCP service keeps
 * the authorization request (`AUTH_REQUEST_TTL_SECS`, 10 minutes). After
 * that the AI app has given up on it.
 */
export const MCP_CONSENT_AUTH_CONTINUATION_TTL_MS = 10 * 60 * 1000;

/** Query parameter of the consent page's "request expired" view (`?expired=1[&client_id=…]`). */
export const MCP_CONSENT_EXPIRED_PARAM = 'expired';

interface AuthContinuation {
  expiresAt: number;
  flowId: string;
  redirectTo: string;
  version: 1;
}

/** A stored continuation. Only kinds with an `expiredLanding` keep expired ones. */
interface StoredAuthContinuation {
  continuation: AuthContinuation;
  expired: boolean;
}

interface AuthFlowChannelMessage {
  flowId: string;
  type: 'authenticated';
}

/**
 * A destination that must survive one sign-in but not a later, unrelated one,
 * and must stay out of login and auth callback URLs (browser history, access
 * logs, referrer headers): a public Form bearer link or an MCP consent request.
 * It is kept in this tab's session storage behind an opaque flow ID. Login and
 * callback URLs carry only that ID, and only a URL carrying it resumes the flow.
 */
interface AuthContinuationKind {
  /** Names the flow in logs. */
  label: string;
  storageKey: string;
  /** Query parameter carrying the flow ID through login and auth callback URLs. */
  flowParam: string;
  /** Tells the tab that started the flow when sign-in completed in another tab (a magic link). */
  channelName: string;
  ttlMs: number;
  /** Whether a safe, same-origin destination belongs to this kind. */
  matches: (url: URL) => boolean;
  /** Logged instead of the destination's path. */
  logPath: string;
  /**
   * Where a sign-in that outlived its continuation lands. A kind with one keeps
   * an expired continuation until sign-in completes, so the user learns that
   * the request expired; a kind without drops it and sign-in goes to /app.
   */
  expiredLanding?: (continuation: AuthContinuation) => string;
}

interface AuthFlow {
  kind: AuthContinuationKind;
  flowId: string;
}

const PUBLIC_FORM_CONTINUATION: AuthContinuationKind = {
  label: 'public Form',
  storageKey: 'publicFormAuthContinuation',
  flowParam: PUBLIC_FORM_AUTH_FLOW_PARAM,
  channelName: 'appflowy-public-form-auth',
  ttlMs: PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS,
  matches: (url) => /^\/form\/[^/]+\/?$/.test(url.pathname),
  logPath: '/form/[redacted]',
};

const MCP_CONSENT_CONTINUATION: AuthContinuationKind = {
  label: 'MCP consent',
  storageKey: 'mcpConsentAuthContinuation',
  flowParam: MCP_CONSENT_AUTH_FLOW_PARAM,
  channelName: 'appflowy-mcp-consent-auth',
  ttlMs: MCP_CONSENT_AUTH_CONTINUATION_TTL_MS,
  matches: (url) => normalizeRoutePathname(url.pathname) === MCP_CONSENT_PATH,
  logPath: MCP_CONSENT_PATH,
  expiredLanding: (continuation) => buildMcpConsentExpiredPath(continuation.redirectTo),
};

const AUTH_CONTINUATION_KINDS: readonly AuthContinuationKind[] = [PUBLIC_FORM_CONTINUATION, MCP_CONSENT_CONTINUATION];

const authFlowChannels = new Map<AuthContinuationKind, BroadcastChannel | null>();

export function saveRedirectTo(redirectTo: string) {
  const safeRedirectTo = getSafeRedirectUrl(redirectTo);

  if (!safeRedirectTo) {
    clearRedirectTo();
    return;
  }

  const kind = authContinuationKindOf(safeRedirectTo);

  if (kind) {
    // Signing in towards the destination itself supersedes an earlier
    // recovery attempt in this flow that never signed in.
    if (storedPasswordResetStep()?.flow.kind === kind) localStorage.removeItem(REDIRECT_TO_STORAGE_KEY);
    // Authentication actions may happen near the end of the continuation
    // window. Preserve only the flow this URL still belongs to instead of
    // silently granting it another full lifetime from the button click.
    if (currentFlowContinuation(kind)?.continuation.redirectTo !== safeRedirectTo) clearAuthContinuation(kind);
    return;
  }

  // The new-password form reached with a recovery code during a flow-bound
  // sign-in continues that flow; any other destination ends it.
  if (!passwordResetFlowOf(safeRedirectTo)) clearAuthContinuations();
  localStorage.setItem(REDIRECT_TO_STORAGE_KEY, safeRedirectTo);
}

/**
 * Where the current login returns to. On a login or callback URL carrying a
 * flow ID this is that flow's destination; for an MCP consent request it is
 * kept after it expired, so the login stays bound to it and `afterAuth` can
 * show the "expired" view instead of returning to it.
 */
export function getRedirectTo() {
  const flow = authFlowFromCurrentUrl();

  // A callback carrying a flow ID belongs only to that flow. Do not fall
  // through to a generic redirect saved by another tab when the destination
  // lives in the originating tab's session storage.
  if (flow) return currentFlowContinuation(flow.kind)?.continuation.redirectTo ?? null;

  // Reading a redirect from a URL outside every flow is an explicit cancel.
  clearAuthContinuations();
  const redirectTo = localStorage.getItem(REDIRECT_TO_STORAGE_KEY);

  // Older Web builds stored Form bearer paths (and MCP consent requests)
  // without an expiry. Do not carry those paths into a later login after
  // upgrading.
  if (redirectTo && isFlowBoundRedirectUrl(redirectTo)) {
    localStorage.removeItem(REDIRECT_TO_STORAGE_KEY);
    return null;
  }

  return redirectTo;
}

export function clearRedirectTo() {
  localStorage.removeItem(REDIRECT_TO_STORAGE_KEY);
  clearAuthContinuations();
}

function createAuthFlowId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Blocked storage (privacy settings) holds nothing to resume.
    return null;
  }
}

function writeSessionStorage(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeSessionStorage(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing could have been stored.
  }
}

/** The flow-bound kind a destination belongs to; null for ordinary destinations. */
function authContinuationKindOf(value: string): AuthContinuationKind | null {
  const safeRedirectTo = getSafeRedirectUrl(value);

  if (!safeRedirectTo) return null;

  const url = new URL(safeRedirectTo, window.location.origin);

  return AUTH_CONTINUATION_KINDS.find((kind) => kind.matches(url)) ?? null;
}

function flowIdFromCurrentUrl(kind: AuthContinuationKind): string | null {
  try {
    const flowId = new URL(window.location.href, window.location.origin).searchParams.get(kind.flowParam);

    return flowId && AUTH_FLOW_ID_PATTERN.test(flowId) ? flowId : null;
  } catch {
    return null;
  }
}

/** The flow the current URL (a login step or an auth callback) belongs to. */
function authFlowFromCurrentUrl(): AuthFlow | null {
  return (
    AUTH_CONTINUATION_KINDS.map((kind) => ({ kind, flowId: flowIdFromCurrentUrl(kind) })).find(
      (flow): flow is AuthFlow => flow.flowId !== null
    ) ?? null
  );
}

function readAuthContinuation(kind: AuthContinuationKind, now = Date.now()): StoredAuthContinuation | null {
  const value = readSessionStorage(kind.storageKey);

  if (!value) return null;

  try {
    const continuation = JSON.parse(value) as Partial<AuthContinuation>;
    const safeRedirectTo =
      typeof continuation.redirectTo === 'string' ? getSafeRedirectUrl(continuation.redirectTo) : null;

    if (
      continuation.version !== 1 ||
      typeof continuation.flowId !== 'string' ||
      !AUTH_FLOW_ID_PATTERN.test(continuation.flowId) ||
      typeof continuation.expiresAt !== 'number' ||
      !Number.isFinite(continuation.expiresAt) ||
      !safeRedirectTo ||
      authContinuationKindOf(safeRedirectTo) !== kind
    ) {
      clearAuthContinuation(kind);
      return null;
    }

    const expired = continuation.expiresAt <= now;

    if (expired && !kind.expiredLanding) {
      clearAuthContinuation(kind);
      return null;
    }

    return {
      continuation: {
        expiresAt: continuation.expiresAt,
        flowId: continuation.flowId,
        redirectTo: safeRedirectTo,
        version: 1,
      },
      expired,
    };
  } catch {
    clearAuthContinuation(kind);
    return null;
  }
}

/** This tab's continuation, but only on a URL that carries its flow ID. */
function currentFlowContinuation(kind: AuthContinuationKind, now = Date.now()): StoredAuthContinuation | null {
  const urlFlowId = flowIdFromCurrentUrl(kind);

  // A stored destination is usable only while the URL proves that this is the
  // same explicit authentication flow. A later plain /login is unrelated.
  if (!urlFlowId) return null;

  const stored = readAuthContinuation(kind, now);

  if (stored?.continuation.flowId !== urlFlowId) return null;

  ensureAuthFlowChannel(kind);
  return stored;
}

/** This tab's continuation wherever the tab is: the page starting the flow, or a login step. */
function tabContinuation(kind: AuthContinuationKind, now = Date.now()): StoredAuthContinuation | null {
  const stored = readAuthContinuation(kind, now);

  if (stored) ensureAuthFlowChannel(kind);
  return stored;
}

function ensureAuthFlowChannel(kind: AuthContinuationKind): BroadcastChannel | null {
  const existing = authFlowChannels.get(kind);

  if (existing !== undefined) return existing;

  if (typeof BroadcastChannel === 'undefined') {
    authFlowChannels.set(kind, null);
    return null;
  }

  const channel = new BroadcastChannel(kind.channelName);

  channel.addEventListener('message', (event: MessageEvent<unknown>) => resumeAuthFlowFromAnotherTab(kind, event.data));
  authFlowChannels.set(kind, channel);
  return channel;
}

function resumeAuthFlowFromAnotherTab(kind: AuthContinuationKind, data: unknown) {
  const message = data as Partial<AuthFlowChannelMessage> | null;

  if (message?.type !== 'authenticated' || !message.flowId || !AUTH_FLOW_ID_PATTERN.test(message.flowId)) {
    return;
  }

  // A stored continuation alone does not prove this tab still owns the
  // authentication flow. The user may have navigated elsewhere while a
  // magic-link callback was open in another tab.
  if (flowIdFromCurrentUrl(kind) !== message.flowId) return;

  const stored = readAuthContinuation(kind);

  if (stored?.continuation.flowId !== message.flowId) return;

  clearAuthContinuation(kind);

  if (!stored.expired) {
    Log.info(`[Auth] ${kind.label} authentication completed in another tab`);
    window.location.href = stored.continuation.redirectTo;
  } else if (kind.expiredLanding) {
    Log.info(`[Auth] ${kind.label} authentication completed in another tab after the request expired`);
    window.location.href = kind.expiredLanding(stored.continuation);
  }
}

function notifyAuthFlowOrigin({ kind, flowId }: AuthFlow) {
  ensureAuthFlowChannel(kind)?.postMessage({
    flowId,
    type: 'authenticated',
  } satisfies AuthFlowChannelMessage);
}

function startAuthContinuation(
  kind: AuthContinuationKind,
  redirectTo: string,
  now: number,
  flowId: string
): string | null {
  const safeRedirectTo = getSafeRedirectUrl(redirectTo);

  if (!safeRedirectTo || authContinuationKindOf(safeRedirectTo) !== kind || !AUTH_FLOW_ID_PATTERN.test(flowId)) {
    clearAuthContinuation(kind);
    return null;
  }

  // One flow-bound sign-in per tab: a new one replaces any other.
  clearAuthContinuations();

  const continuation: AuthContinuation = {
    expiresAt: now + kind.ttlMs,
    flowId,
    redirectTo: safeRedirectTo,
    version: 1,
  };

  // The destination never enters persistent storage. An auth callback opened
  // in a second tab broadcasts only this opaque flow ID back to the
  // originating tab.
  if (!writeSessionStorage(kind.storageKey, JSON.stringify(continuation))) return null;

  ensureAuthFlowChannel(kind);
  return flowId;
}

function clearAuthContinuation(kind: AuthContinuationKind) {
  removeSessionStorage(kind.storageKey);
}

function clearAuthContinuations() {
  AUTH_CONTINUATION_KINDS.forEach(clearAuthContinuation);
}

export function savePublicFormRedirectTo(
  redirectTo: string,
  now = Date.now(),
  flowId = createAuthFlowId()
): string | null {
  return startAuthContinuation(PUBLIC_FORM_CONTINUATION, redirectTo, now, flowId);
}

/**
 * Keeps an MCP consent request (the whole `/oauth/mcp/authorize?…` URL)
 * across sign-in for `MCP_CONSENT_AUTH_CONTINUATION_TTL_MS`, out of login URLs
 * and persistent storage. Returns the flow ID that `buildLoginUrl` then puts in
 * the login URL, or null when `redirectTo` is not a consent request or session
 * storage is unavailable.
 */
export function saveMcpConsentRedirectTo(
  redirectTo: string,
  now = Date.now(),
  flowId = createAuthFlowId()
): string | null {
  return startAuthContinuation(MCP_CONSENT_CONTINUATION, redirectTo, now, flowId);
}

/**
 * Starts the flow-bound continuation `redirectTo` belongs to (a public Form
 * link or an MCP consent request). Returns the login query parameter and the
 * flow ID it carries; null for any other destination or when storage fails.
 */
export function saveFlowBoundRedirectTo(
  redirectTo: string,
  now = Date.now()
): { flowParam: string; flowId: string } | null {
  const kind = authContinuationKindOf(redirectTo);
  const flowId = kind ? startAuthContinuation(kind, redirectTo, now, createAuthFlowId()) : null;

  return kind && flowId ? { flowParam: kind.flowParam, flowId } : null;
}

export function getPublicFormRedirectTo(now = Date.now()): string | null {
  return currentFlowContinuation(PUBLIC_FORM_CONTINUATION, now)?.continuation.redirectTo ?? null;
}

export function getPublicFormRedirectExpiresAt(now = Date.now()): number | null {
  return tabContinuation(PUBLIC_FORM_CONTINUATION, now)?.continuation.expiresAt ?? null;
}

export function clearPublicFormRedirectTo() {
  clearAuthContinuation(PUBLIC_FORM_CONTINUATION);
}

/**
 * The consent page's "request expired" view, where a sign-in lands when it
 * outlived the consent request it started from. Only the client ID travels
 * along, to name the app.
 */
export function buildMcpConsentExpiredPath(consentUrl?: string | null): string {
  const search = new URLSearchParams({ [MCP_CONSENT_EXPIRED_PARAM]: '1' });
  let clientId: string | null = null;

  try {
    clientId = consentUrl ? new URL(consentUrl, window.location.origin).searchParams.get('client_id') : null;
  } catch {
    clientId = null;
  }

  if (clientId) search.set('client_id', clientId);
  return `${MCP_CONSENT_PATH}?${search.toString()}`;
}

export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_CALLBACK_URL = `${window.location.origin}${AUTH_CALLBACK_PATH}`;

export function getAuthCallbackUrl(redirectTo: string): string {
  const callbackUrl = new URL(AUTH_CALLBACK_URL);
  const flow = boundAuthFlow(redirectTo);

  if (flow) callbackUrl.searchParams.set(flow.kind.flowParam, flow.flowId);

  return callbackUrl.toString();
}

/** The flow a flow-bound destination belongs to in this tab, when this tab's continuation leads there. */
function boundAuthFlow(redirectTo: string | null | undefined): AuthFlow | null {
  const safeRedirectTo = redirectTo ? getSafeRedirectUrl(redirectTo) : null;
  const kind = safeRedirectTo ? authContinuationKindOf(safeRedirectTo) : null;
  const stored = kind ? tabContinuation(kind) : null;

  return kind && stored?.continuation.redirectTo === safeRedirectTo
    ? { kind, flowId: stored.continuation.flowId }
    : null;
}

/**
 * The flow a new-password login URL continues. A recovery code entered during
 * a flow-bound sign-in keeps the flow ID in that URL, so signing in again
 * after the reset still returns to the flow's destination.
 */
function passwordResetFlowOf(safeRedirectTo: string): AuthFlow | null {
  const url = new URL(safeRedirectTo, window.location.origin);

  if (!isPasswordResetForm(url)) return null;

  return (
    AUTH_CONTINUATION_KINDS.map((kind) => ({ kind, flowId: url.searchParams.get(kind.flowParam) })).find(
      (flow): flow is AuthFlow =>
        flow.flowId !== null && readAuthContinuation(flow.kind)?.continuation.flowId === flow.flowId
    ) ?? null
  );
}

/** The new-password form `saveRedirectTo` stored during a recovery sign-in, with the flow it continues. */
function storedPasswordResetStep(): { url: string; flow: AuthFlow } | null {
  const stored = localStorage.getItem(REDIRECT_TO_STORAGE_KEY);
  const safeRedirectTo = stored ? getSafeRedirectUrl(stored) : null;
  const flow = safeRedirectTo ? passwordResetFlowOf(safeRedirectTo) : null;

  return safeRedirectTo && flow ? { url: safeRedirectTo, flow } : null;
}

/** `flow`'s new-password step, taken from storage. */
function takePasswordResetStep(flow: AuthFlow): string | null {
  const step = storedPasswordResetStep();

  if (step?.flow.kind !== flow.kind || step.flow.flowId !== flow.flowId) return null;

  localStorage.removeItem(REDIRECT_TO_STORAGE_KEY);
  return step.url;
}

// Login-page action that shows the new-password form after a recovery code.
export const PASSWORD_RESET_LOGIN_ACTION = 'changePassword';

function normalizeRoutePathname(pathname: string): string | null {
  let decodedPathname: string;

  try {
    // Match React Router's segment decoding while preserving encoded slashes,
    // which are data inside a segment rather than route separators.
    decodedPathname = pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    return null;
  }

  return decodedPathname.replace(/\/+$/, '').toLowerCase();
}

export function isAuthPath(pathname: string): boolean {
  const normalizedPathname = normalizeRoutePathname(pathname);

  return normalizedPathname === '/login' || normalizedPathname === AUTH_CALLBACK_PATH;
}

// A recovery session must still reach the new-password form on the login page.
function isPasswordResetForm(url: URL): boolean {
  return (
    normalizeRoutePathname(url.pathname) === '/login' &&
    url.searchParams.get('action') === PASSWORD_RESET_LOGIN_ACTION
  );
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
  return authContinuationKindOf(value) === PUBLIC_FORM_CONTINUATION;
}

export function isMcpConsentRedirectUrl(value: string): boolean {
  return authContinuationKindOf(value) === MCP_CONSENT_CONTINUATION;
}

/**
 * A destination kept behind a flow ID (a public Form link or an MCP consent
 * request), never in login URLs or persistent storage.
 */
export function isFlowBoundRedirectUrl(value: string): boolean {
  return authContinuationKindOf(value) !== null;
}

/**
 * Builds an internal login URL without allowing values to alter the surrounding
 * query string. Callers must pass raw values; URLSearchParams owns the encoding.
 */
export function buildLoginUrl(params: LoginUrlParams = {}): string {
  const search = new URLSearchParams();
  const safeRedirectTo = params.redirectTo ? getSafeRedirectUrl(params.redirectTo) : null;
  const flowBound = safeRedirectTo ? isFlowBoundRedirectUrl(safeRedirectTo) : false;
  const flow = flowBound ? boundAuthFlow(safeRedirectTo) : null;

  if (params.action) search.set('action', params.action);
  if (params.email) search.set('email', params.email);
  // Public Form URLs act as bearer links, and MCP consent URLs carry an OAuth
  // authorization request. Their continuation is kept in guarded same-origin
  // storage, never copied into login query strings where it could reach
  // browser history, access logs, or referrer headers.
  if (safeRedirectTo && !flowBound) search.set('redirectTo', safeRedirectTo);
  if (params.type) search.set('type', params.type);
  if (params.force !== undefined || flow) search.set('force', String(flow ? true : params.force));
  if (flow) search.set(flow.kind.flowParam, flow.flowId);

  const query = search.toString();

  return query ? `/login?${query}` : '/login';
}

export function afterAuth() {
  const flow = authFlowFromCurrentUrl();

  if (!flow) {
    const redirectTo = getRedirectTo();

    clearRedirectTo();
    navigateAfterAuth(redirectTo);
    return;
  }

  // A recovery code signed in on the way to this flow's new-password form.
  // The flow continues after the reset, so its continuation stays.
  const passwordReset = takePasswordResetStep(flow);

  if (passwordReset) {
    Log.info(`[Auth] afterAuth: continuing the ${flow.kind.label} sign-in at the new-password form`);
    window.location.href = passwordReset;
    return;
  }

  const stored = currentFlowContinuation(flow.kind);

  clearAuthContinuation(flow.kind);

  if (stored && !stored.expired) {
    navigateAfterAuth(stored.continuation.redirectTo);
    return;
  }

  if (stored && flow.kind.expiredLanding) {
    // Return only while the flow is valid: whoever started it has given up.
    Log.info(`[Auth] afterAuth: the ${flow.kind.label} request expired during sign-in`);
    window.location.href = flow.kind.expiredLanding(stored.continuation);
    return;
  }

  // The flow started in another tab (a magic link opened here): resume it there.
  notifyAuthFlowOrigin(flow);
  Log.info('[Auth] afterAuth: no redirectTo saved, going to /app');
  window.location.href = '/app';
}

function navigateAfterAuth(redirectTo: string | null) {
  if (!redirectTo) {
    Log.info('[Auth] afterAuth: no redirectTo saved, going to /app');
    window.location.href = '/app';
    return;
  }

  const safeRedirectTo = getSafeRedirectUrl(redirectTo);

  if (!safeRedirectTo) {
    window.location.href = '/app';
    return;
  }

  const url = new URL(safeRedirectTo, window.location.origin);
  const pathname = url.pathname;
  const logPathname = authContinuationKindOf(safeRedirectTo)?.logPath ?? pathname;

  // Check if URL contains workspace/view UUIDs (user-specific paths)
  // Pattern matches /app/{uuid}/{uuid} or /app/{uuid}
  const hasUserSpecificIds = /\/app\/[a-f0-9-]{36}/i.test(pathname);

  if (isAuthPath(pathname) && !isPasswordResetForm(url)) {
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
}
