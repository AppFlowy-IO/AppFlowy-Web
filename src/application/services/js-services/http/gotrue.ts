import axios, { AxiosInstance } from 'axios';

import { emit, EventType } from '@/application/session';
import { getTokenParsed, saveGoTrueAuth } from '@/application/session/token';

import { Log } from '@/utils/log';
import { verifyToken } from './cloud-auth';
import { GoTrueErrorCode, parseGoTrueError } from './gotrue-error';

export * from './gotrue-error';

let axiosInstance: AxiosInstance | null = null;

interface VerifyAndRefreshGoTrueTokenParams {
  accessToken: string;
  refreshToken: string;
  logContext: string;
  verifyErrorMessage?: string;
  refreshErrorMessage?: string;
  useVerifyErrorMessage?: boolean;
}

export function initGrantService(baseURL: string) {
  if (axiosInstance) {
    return;
  }

  axiosInstance = axios.create({
    baseURL,
  });

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
}

// In-flight refreshes shared by concurrent callers with the same refresh token
// (axios request interceptor, 401 retry handler, WebSocket reconnect). This
// must be keyed by token: different sessions/tokens may refresh concurrently,
// but duplicate requests for one rotating refresh token must join the same
// promise or the later request can consume an already-used token.
const refreshInFlightByToken = new Map<string, Promise<RefreshedToken>>();

export async function refreshToken(refresh_token: string) {
  const inFlight = refreshInFlightByToken.get(refresh_token);

  if (inFlight) {
    Log.debug('[Auth] refreshToken: joining in-flight refresh');
    return inFlight;
  }

  Log.info('[Auth] refreshToken: requesting new token');

  const promise = (async (): Promise<RefreshedToken> => {
    const response = await axiosInstance?.post<RefreshedToken>('/token?grant_type=refresh_token', {
      refresh_token,
    });

    const newToken = response?.data;

    if (newToken) {
      Log.info('[Auth] refreshToken: success, saving token');
      saveGoTrueAuth(JSON.stringify(newToken));
    } else {
      Log.error('[Auth] refreshToken: no token data in response');
      return Promise.reject('Failed to refresh token');
    }

    return newToken;
  })();

  refreshInFlightByToken.set(refresh_token, promise);

  try {
    return await promise;
  } finally {
    if (refreshInFlightByToken.get(refresh_token) === promise) {
      refreshInFlightByToken.delete(refresh_token);
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
      emit(EventType.SESSION_INVALID);
      return Promise.reject({
        code: -1,
        message: 'Failed to send recovery email',
      });
    }
    // eslint-disable-next-line
  } catch (e: any) {
    Log.error('[Auth] forgotPassword: failed', { status: e.response?.status, message: e.message });
    emit(EventType.SESSION_INVALID);
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
    emit(EventType.SESSION_INVALID);
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
  const url = `${baseURL}/authorize?provider=${provider}&redirect_to=${redirectTo}`;

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
