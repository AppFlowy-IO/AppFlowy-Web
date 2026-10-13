import axios, { AxiosInstance } from 'axios';

import {
  getTokenParsed,
  invalidToken,
  saveGoTrueAuth,
  type GoTrueAuthToken,
  type GoTrueAuthUser,
} from '@/application/session/token';
import { parseAuthToken } from '@/application/session/token-storage';
import { CUSTOM_PROVIDER_PREFIX } from '@/application/types';
import { Log } from '@/utils/log';

import { verifyToken } from './cloud-auth';
import { GoTrueErrorCode, parseGoTrueError } from './gotrue-error';

export * from './gotrue-error';

let axiosInstance: AxiosInstance | null = null;
let grantBaseUrl: string | undefined;

interface VerifyAndRefreshGoTrueTokenParams {
  accessToken: string;
  refreshToken: string;
  logContext: string;
  verifyErrorMessage?: string;
  refreshErrorMessage?: string;
  useVerifyErrorMessage?: boolean;
}

export function initGrantService(baseURL: string) {
  if (axiosInstance && grantBaseUrl === baseURL) {
    return;
  }

  axiosInstance = axios.create({
    baseURL,
  });
  grantBaseUrl = baseURL;

  axiosInstance.interceptors.request.use((config) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Skip x-platform header for GoTrue requests to avoid CORS issues
    // GoTrue doesn't include x-platform in its Access-Control-Allow-Headers

    Object.assign(config.headers, headers);

    return config;
  });
}

interface RefreshedToken {
  access_token: string;
  expires_at: number;
  refresh_token: string;
  user: GoTrueAuthUser;
}

/**
 * A refresh finished after this tab's session was replaced: sign-out, sign-in as
 * another account, or a server switch. The caller must neither apply the result
 * nor invalidate the replacement session.
 */
export class AuthSessionChangedError extends Error {
  constructor() {
    super('The authentication context changed during token refresh');
    this.name = 'AuthSessionChangedError';
  }
}

export function isAuthSessionChangedError(error: unknown): boolean {
  return error instanceof AuthSessionChangedError || (error as { name?: unknown })?.name === 'AuthSessionChangedError';
}

const DEFINITIVE_REFRESH_STATUS_CODES = new Set([400, 401, 403]);
const DEFINITIVE_REFRESH_MARKERS = [
  'invalid_grant',
  'invalid refresh token',
  'refresh token is invalid',
  'refresh token has expired',
  'session_not_found',
  'session not found',
];

/**
 * True only when GoTrue rejected the refresh token itself. Network failures,
 * timeouts, rate limits and 5xx responses are transient: the stored session is
 * kept so the next request can refresh it again.
 */
export function isDefinitiveRefreshFailure(error: unknown): boolean {
  if (isAuthSessionChangedError(error)) return false;
  if (typeof error !== 'object' || error === null || !(error as { isAxiosError?: unknown }).isAxiosError) {
    // A missing body or a token that cannot be stored leaves no usable session.
    return true;
  }

  const response = (error as { response?: { status?: unknown; data?: unknown } }).response;

  if (typeof response?.status === 'number' && DEFINITIVE_REFRESH_STATUS_CODES.has(response.status)) return true;
  const data = response?.data;
  const text = (typeof data === 'string' ? data : JSON.stringify(data ?? '')).toLowerCase();

  return DEFINITIVE_REFRESH_MARKERS.some((marker) => text.includes(marker));
}

function isExpiredSession(session: GoTrueAuthToken): boolean {
  return session.expires_at * 1000 <= Date.now();
}

function sameStoredSession(left: GoTrueAuthToken, right: GoTrueAuthToken): boolean {
  return left.access_token === right.access_token && left.refresh_token === right.refresh_token &&
    left.user.id === right.user.id;
}

function asRefreshedToken(session: GoTrueAuthToken): RefreshedToken {
  return {
    access_token: session.access_token,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
}

// In-flight refreshes shared by concurrent callers with the same server and refresh token
// (axios request interceptor, 401 retry handler, WebSocket reconnect). This
// must be keyed by server and token: different sessions may refresh concurrently,
// but duplicate requests for one rotating refresh token must join the same
// promise or the later request can consume an already-used token.
//
// Sibling tabs share the stored token but not this map. When another tab has
// already exchanged the same refresh token, the stored rotation for the same
// account is adopted instead of being overwritten or treated as a sign-out.
const refreshInFlightByToken = new Map<string, Promise<RefreshedToken>>();

export async function refreshToken(refresh_token: string) {
  const requestKey = JSON.stringify([grantBaseUrl, refresh_token]);
  const inFlight = refreshInFlightByToken.get(requestKey);

  if (inFlight) {
    Log.debug('[Auth] refreshToken: joining in-flight refresh');
    return inFlight;
  }

  Log.info('[Auth] refreshToken: requesting new token');
  const client = axiosInstance;
  const originalSession = getTokenParsed();
  // The account owning this refresh token is known only when it is the stored one.
  const ownerUserId = originalSession?.refresh_token === refresh_token ? originalSession.user.id : undefined;

  const promise = (async (): Promise<RefreshedToken> => {
    let response: { data?: RefreshedToken } | undefined;

    try {
      response = await client?.post<RefreshedToken>('/token?grant_type=refresh_token', {
        refresh_token,
      });
    } catch (error) {
      if (axiosInstance !== client) throw new AuthSessionChangedError();
      const current = getTokenParsed();

      if (originalSession && (!current || current.user.id !== originalSession.user.id)) {
        throw new AuthSessionChangedError();
      }

      // Rotating refresh tokens are single-use: a sibling tab may have exchanged
      // this one first. Its stored rotation for the same account is still valid.
      if (ownerUserId && current && current.user.id === ownerUserId && current.refresh_token !== refresh_token &&
        !isExpiredSession(current)) {
        Log.info('[Auth] refreshToken: adopting a token already rotated by another tab');
        return asRefreshedToken(current);
      }

      throw error;
    }

    // Logout, a new sign-in, or a server switch must not be undone by a late refresh.
    if (axiosInstance !== client) throw new AuthSessionChangedError();
    const newToken = response?.data;

    if (!newToken) {
      Log.error('[Auth] refreshToken: no token data in response');
      return Promise.reject('Failed to refresh token');
    }

    const refreshed = parseAuthToken(JSON.stringify(newToken));
    const current = getTokenParsed();

    if (!current) {
      if (originalSession) throw new AuthSessionChangedError();
    } else if (!originalSession || !sameStoredSession(current, originalSession)) {
      // The stored session changed while this request was in flight. A
      // background refresh never switches the signed-in account.
      if (!refreshed || current.user.id !== refreshed.user.id) throw new AuthSessionChangedError();

      // Another tab or path stored a newer token for this account. Keep it:
      // both are valid, and overwriting would make tabs ping-pong.
      if (!isExpiredSession(current)) {
        Log.info('[Auth] refreshToken: keeping the token another tab already stored');
        return asRefreshedToken(current);
      }
    } else if (refreshed && current.user.id !== refreshed.user.id) {
      throw new AuthSessionChangedError();
    }

    Log.info('[Auth] refreshToken: success, saving token');
    if (!saveGoTrueAuth(JSON.stringify(newToken))) {
      throw new Error('Failed to persist refreshed token');
    }

    return newToken;
  })();

  refreshInFlightByToken.set(requestKey, promise);

  try {
    return await promise;
  } finally {
    if (refreshInFlightByToken.get(requestKey) === promise) {
      refreshInFlightByToken.delete(requestKey);
    }
  }
}

function normalizeAuthFlowError(error: unknown, fallbackMessage: string, useErrorMessage: boolean) {
  const err = error as { message?: string; code?: number };
  const message =
    useErrorMessage && typeof err?.message === 'string' ? err.message.replace(/\s*\[.*\]$/, '') : fallbackMessage;

  return {
    code: err?.code ?? -1,
    message,
  };
}

export async function verifyAndRefreshGoTrueToken({
  accessToken,
  refreshToken: refresh_token,
  logContext,
  verifyErrorMessage = 'Failed to verify token',
  refreshErrorMessage = 'Failed to refresh token',
  useVerifyErrorMessage = true,
}: VerifyAndRefreshGoTrueTokenParams) {
  // Clear the previous session before AppFlowy Cloud verification so axios
  // interceptors cannot refresh or invalidate an old token during the new login.
  if (localStorage.getItem('token')) {
    Log.info(`[Auth] ${logContext}: clearing old token before auth flow`);
    localStorage.removeItem('token');
  }

  Log.info(`[Auth] ${logContext}: verifying token with AppFlowy Cloud`);
  try {
    const result = await verifyToken(accessToken);

    Log.info(`[Auth] ${logContext}: verifyToken completed`, { isNewUser: result.is_new });
  } catch (error: unknown) {
    const normalized = normalizeAuthFlowError(error, verifyErrorMessage, useVerifyErrorMessage);

    Log.error(`[Auth] ${logContext}: verifyToken failed`, normalized);
    return Promise.reject(normalized);
  }

  Log.info(`[Auth] ${logContext}: refreshing token`);
  try {
    await refreshToken(refresh_token);
  } catch (error: unknown) {
    const normalized = normalizeAuthFlowError(error, refreshErrorMessage, false);

    Log.error(`[Auth] ${logContext}: refreshToken failed`, normalized);
    return Promise.reject(normalized);
  }
}

export async function signInWithPassword(params: { email: string; password: string; redirectTo: string }) {
  Log.info('[Auth] signInWithPassword: starting', { email: params.email });
  try {
    const response = await axiosInstance?.post<{
      access_token: string;
      expires_at: number;
      refresh_token: string;
    }>('/token?grant_type=password', {
      email: params.email,
      password: params.password,
    });

    const data = response?.data;

    if (data) {
      Log.info('[Auth] signInWithPassword: GoTrue returned tokens, completing auth flow');
      return verifyAndRefreshGoTrueToken({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        logContext: 'signInWithPassword',
      });
    } else {
      Log.error('[Auth] signInWithPassword: GoTrue returned no data');
      return Promise.reject({
        code: -1,
        message: 'Failed to sign in with password',
      });
    }
    // eslint-disable-next-line
  } catch (e: any) {
    // Parse error from response
    const error = parseGoTrueError({
      error: e.response?.data?.error,
      errorDescription: e.response?.data?.error_description || e.response?.data?.msg,
      errorCode: e.response?.status,
      message: e.response?.data?.message || 'Incorrect password. Please try again.',
    });

    Log.error('[Auth] signInWithPassword: failed', {
      status: e.response?.status,
      code: error.code,
      message: error.message,
    });

    return Promise.reject({
      code: error.code,
      message: error.message,
    });
  }
}

export async function signUpWithPassword(params: { email: string; password: string; redirectTo: string }) {
  Log.info('[Auth] signUpWithPassword: starting', { email: params.email });
  try {
    const response = await axiosInstance?.post<{
      access_token?: string;
      expires_at?: number;
      refresh_token?: string;
      confirmation_sent_at?: string;
      identities?: unknown[];
    }>('/signup', {
      email: params.email,
      password: params.password,
    });

    const data = response?.data;

    Log.info('[Auth] signUpWithPassword: GoTrue response', {
      hasAccessToken: !!data?.access_token,
      hasConfirmation: !!data?.confirmation_sent_at,
      identitiesCount: data?.identities?.length,
    });

    if (data) {
      // GoTrue returns 200 with an empty identities array when the email is
      // already registered and confirmed (to prevent email enumeration).
      // Treat this as "already registered".
      if (!data.access_token && Array.isArray(data.identities) && data.identities.length === 0) {
        Log.warn('[Auth] signUpWithPassword: email already registered', { email: params.email });
        return Promise.reject({
          code: 422,
          message: 'Email already registered',
        });
      }

      // If email confirmation is required, the response won't contain an access_token.
      // Notify the caller so the UI can redirect to the "check your email" step.
      if (data.confirmation_sent_at && !data.access_token) {
        // For already-existing unconfirmed users, GoTrue won't resend the confirmation
        // email on /signup. Call /resend to ensure the user receives a new OTP.
        try {
          const resendRes = await axiosInstance?.post('/resend', {
            type: 'signup',
            email: params.email,
          });

          Log.info('Resend confirmation email response', resendRes?.status, resendRes?.data);
        } catch (resendErr: unknown) {
          // Ignore resend errors (e.g. rate limiting) — the user may still
          // have a valid OTP from the original signup or a previous resend.
          Log.warn('Resend confirmation email failed', resendErr);
        }

        return Promise.reject({
          code: 0,
          message: 'confirmation_email_sent',
        });
      }

      Log.info('[Auth] signUpWithPassword: GoTrue returned tokens, completing auth flow');
      return verifyAndRefreshGoTrueToken({
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string,
        logContext: 'signUpWithPassword',
      });
    } else {
      Log.error('[Auth] signUpWithPassword: GoTrue returned no data');
      return Promise.reject({
        code: -1,
        message: 'Failed to sign up with password',
      });
    }
    // eslint-disable-next-line
  } catch (e: any) {
    const error = parseGoTrueError({
      error: e.response?.data?.error,
      errorDescription: e.response?.data?.error_description || e.response?.data?.msg,
      errorCode: e.response?.status,
      message: e.response?.data?.message || 'Failed to sign up with password.',
    });

    Log.error('[Auth] signUpWithPassword: failed', {
      status: e.response?.status,
      code: error.code,
      message: error.message,
    });

    return Promise.reject({
      code: error.code,
      message: error.message,
    });
  }
}

export async function forgotPassword(params: { email: string }) {
  Log.info('[Auth] forgotPassword: sending recovery email', { email: params.email });
  try {
    const response = await axiosInstance?.post<{
      access_token: string;
      expires_at: number;
      refresh_token: string;
    }>('/recover', {
      email: params.email,
    });

    if (response?.data) {
      Log.info('[Auth] forgotPassword: recovery email sent');
      return;
    } else {
      Log.error('[Auth] forgotPassword: GoTrue returned no data');
      return Promise.reject({
        code: -1,
        message: 'Failed to send recovery email',
      });
    }
    // eslint-disable-next-line
  } catch (e: any) {
    Log.error('[Auth] forgotPassword: failed', { status: e.response?.status, message: e.message });
    return Promise.reject({
      code: -1,
      message: e.message,
    });
  }
}

export async function changePassword(params: { password: string }) {
  Log.info('[Auth] changePassword: starting');
  try {
    const token = getTokenParsed();
    const access_token = token?.access_token;

    if (!access_token) {
      Log.warn('[Auth] changePassword: no access token found');
      return Promise.reject({
        code: -1,
        message: 'You have not logged in yet. Can not change password.',
      });
    }

    await axiosInstance?.post<{
      code: number;
      msg: string;
    }>(
      '/user/change-password',
      {
        password: params.password,
        current_password: params.password,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    Log.info('[Auth] changePassword: success');
    return;
    // eslint-disable-next-line
  } catch (e: any) {
    Log.error('[Auth] changePassword: failed', {
      status: e.response?.status,
      message: e.response?.data?.msg || e.message,
    });
    // Only an authentication failure invalidates the session. Network, rate
    // limit, validation, and server errors leave the stored session usable.
    if (e.response?.status === 401) {
      invalidToken();
    }

    return Promise.reject({
      code: -1,
      message: e.response?.data?.msg || e.message,
    });
  }
}

export async function signInOTP({
  email,
  code,
  type = 'magiclink',
}: {
  email: string;
  code: string;
  type?: 'magiclink' | 'recovery' | 'signup';
}) {
  Log.info('[Auth] signInOTP: starting', { email, type });
  try {
    const response = await axiosInstance?.post<{
      access_token: string;
      expires_at: number;
      refresh_token: string;
      code?: number;
      msg?: string;
    }>('/verify', {
      email,
      token: code,
      type,
    });

    const data = response?.data;

    if (data) {
      if (!data.code) {
        Log.info('[Auth] signInOTP: GoTrue returned tokens, completing auth flow');
        return verifyAndRefreshGoTrueToken({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          logContext: 'signInOTP',
          verifyErrorMessage: 'Failed to create user account',
          useVerifyErrorMessage: false,
        });
      } else {
        Log.error('[Auth] signInOTP: GoTrue returned error', { code: data.code, msg: data.msg });
        return Promise.reject({
          code: data.code,
          message: data.msg,
        });
      }
    } else {
      Log.error('[Auth] signInOTP: GoTrue returned no data');
      return Promise.reject({
        code: 'invalid_token',
        message: 'Invalid token',
      });
    }
    // eslint-disable-next-line
  } catch (e: any) {
    Log.error('[Auth] signInOTP: failed', {
      status: e.response?.status,
      code: e.response?.data?.code,
      message: e.response?.data?.msg || e.message,
    });
    return Promise.reject({
      code: e.response?.data?.code || e.response?.status,
      message: e.response?.data?.msg || e.message,
    });
  }

  return;
}

export async function signInWithMagicLink(email: string, authUrl: string) {
  Log.info('[Auth] signInWithMagicLink: requesting magic link', { email });
  const res = await axiosInstance?.post(
    '/magiclink',
    {
      code_challenge: '',
      code_challenge_method: '',
      data: {},
      email,
    },
    {
      headers: {
        Redirect_to: authUrl,
      },
    }
  );

  Log.info('[Auth] signInWithMagicLink: magic link sent');
  return res?.data;
}

export async function settings() {
  const res = await axiosInstance?.get('/settings');

  return res?.data;
}

function redirectToAuthProvider(url: string) {
  window.location.assign(url);
}

export function signInGoogle(authUrl: string) {
  const provider = 'google';
  const redirectTo = encodeURIComponent(authUrl);
  const baseURL = axiosInstance?.defaults.baseURL;
  const url = `${baseURL}/authorize?provider=${provider}&redirect_to=${redirectTo}&prompt=consent`;

  Log.info('[Auth] signInGoogle: redirecting to Google OAuth');
  redirectToAuthProvider(url);
}

export function signInApple(authUrl: string) {
  const provider = 'apple';
  const redirectTo = encodeURIComponent(authUrl);
  const baseURL = axiosInstance?.defaults.baseURL;
  const url = `${baseURL}/authorize?provider=${provider}&redirect_to=${redirectTo}`;

  Log.info('[Auth] signInApple: redirecting to Apple OAuth');
  redirectToAuthProvider(url);
}

/**
 * Start a login through an admin-registered OIDC/OAuth2 provider.
 *
 * Same shape as the built-in providers above; only the identifier is dynamic.
 * It carries the mandatory `custom:` prefix, added here when the caller passes
 * the bare identifier, and is percent-encoded because the colon is reserved.
 */
export function signInCustomProvider(identifier: string, authUrl: string) {
  const trimmed = identifier.trim();

  if (!trimmed || trimmed === CUSTOM_PROVIDER_PREFIX) {
    Log.error('[Auth] signInCustomProvider: empty provider identifier');
    return;
  }

  const provider = trimmed.startsWith(CUSTOM_PROVIDER_PREFIX) ? trimmed : `${CUSTOM_PROVIDER_PREFIX}${trimmed}`;
  const redirectTo = encodeURIComponent(authUrl);
  const baseURL = axiosInstance?.defaults.baseURL;
  const url = `${baseURL}/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${redirectTo}`;

  Log.info('[Auth] signInCustomProvider: redirecting to provider', { provider });
  redirectToAuthProvider(url);
}

export function signInGithub(authUrl: string) {
  const provider = 'github';
  const redirectTo = encodeURIComponent(authUrl);
  const baseURL = axiosInstance?.defaults.baseURL;
  const url = `${baseURL}/authorize?provider=${provider}&redirect_to=${redirectTo}`;

  Log.info('[Auth] signInGithub: redirecting to GitHub OAuth');
  redirectToAuthProvider(url);
}

export function signInDiscord(authUrl: string) {
  const provider = 'discord';
  const redirectTo = encodeURIComponent(authUrl);
  const baseURL = axiosInstance?.defaults.baseURL;
  const url = `${baseURL}/authorize?provider=${provider}&redirect_to=${redirectTo}`;

  Log.info('[Auth] signInDiscord: redirecting to Discord OAuth');
  redirectToAuthProvider(url);
}

interface AxiosErrorLike {
  response?: {
    data?: { message?: string; msg?: string };
    status?: number;
  };
  message?: string;
}

/**
 * Initiates SAML SSO login flow
 * @param authUrl - The callback URL after SSO completes
 * @param domain - The email domain to identify the SSO provider (e.g., "company.com")
 */
export async function signInSaml(authUrl: string, domain: string): Promise<void> {
  try {
    // POST to /sso endpoint with skip_http_redirect to get IdP URL in JSON
    // This avoids CORS issues from automatic redirect following
    const response = await axiosInstance?.post<{ url: string }>('/sso', {
      domain,
      redirect_to: authUrl,
      skip_http_redirect: true,
    });

    const idpUrl = response?.data?.url;

    if (idpUrl) {
      // Redirect to the Identity Provider login page
      window.location.href = idpUrl;
      return;
    }

    return Promise.reject({
      code: GoTrueErrorCode.UNKNOWN,
      message: 'No SSO redirect URL returned',
    });
  } catch (e: unknown) {
    const err = e as AxiosErrorLike;
    const errorMessage = err.response?.data?.message || err.response?.data?.msg || err.message || 'SSO login failed';

    return Promise.reject({
      code: err.response?.status || GoTrueErrorCode.UNKNOWN,
      message: errorMessage,
    });
  }
}
