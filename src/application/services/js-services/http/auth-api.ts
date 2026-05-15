import { AuthProvider } from '@/application/types';
import { Log } from '@/utils/log';

import { refreshToken, settings as getGoTrueSettings } from './gotrue';
import { parseGoTrueErrorFromUrl } from './gotrue-error';
import { APIError, APIResponse, executeAPIRequest, getAxios } from './core';

export interface ServerInfo {
  enable_page_history: boolean;
  ai_enabled?: boolean;
}

interface GoTrueSettingsPayload {
  external?: Record<string, boolean>;
  saml_enabled?: boolean;
}

function mapAuthProvider(provider: string): AuthProvider | null {
  switch (provider.toLowerCase()) {
    case 'google':
      return AuthProvider.GOOGLE;
    case 'apple':
      return AuthProvider.APPLE;
    case 'github':
      return AuthProvider.GITHUB;
    case 'discord':
      return AuthProvider.DISCORD;
    case 'authentik':
      return AuthProvider.AUTHENTIK;
    case 'email':
      return AuthProvider.EMAIL;
    case 'password':
      return AuthProvider.PASSWORD;
    case 'magic_link':
      return AuthProvider.MAGIC_LINK;
    case 'saml':
      return AuthProvider.SAML;
    case 'oidc':
      return AuthProvider.OIDC;
    case 'phone':
      return AuthProvider.PHONE;
    default:
      console.warn(`Unknown auth provider from server: ${provider}`);
      return null;
  }
}

function mapAuthProviders(providers: string[]): AuthProvider[] {
  return providers.map(mapAuthProvider).filter((provider): provider is AuthProvider => provider !== null);
}

export async function signInWithUrl(url: string) {
  Log.info('[Auth] signInWithUrl: processing OAuth callback');

  // First check for GoTrue errors in the URL
  const gotrueError = parseGoTrueErrorFromUrl(url);

  if (gotrueError) {
    Log.error('[Auth] signInWithUrl: GoTrue error in callback URL', {
      code: gotrueError.code,
      message: gotrueError.message,
    });
    return Promise.reject({
      code: gotrueError.code,
      message: gotrueError.message,
    });
  }

  // No errors found, proceed with normal token extraction
  const urlObj = new URL(url);
  const hash = urlObj.hash;

  if (!hash) {
    Log.error('[Auth] signInWithUrl: no hash fragment in callback URL');
    return Promise.reject('No hash found');
  }

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (!accessToken || !refresh_token) {
    Log.error('[Auth] signInWithUrl: missing tokens in callback hash', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refresh_token,
    });
    return Promise.reject({
      code: -1,
      message: 'No access token or refresh token found',
    });
  }

  Log.info('[Auth] signInWithUrl: tokens extracted from callback URL');

  // CRITICAL: Clear old token BEFORE processing new OAuth tokens
  // This prevents axios interceptor from trying to auto-refresh the old expired token
  // during verifyToken() API call, which would cause a race condition where:
  // 1. verifyToken() makes API call with NEW token in URL
  // 2. Axios interceptor sees OLD token in localStorage, tries to refresh it
  // 3. Old token refresh fails → invalidToken() called → session invalidated
  // 4. Meanwhile, OAuth flow is trying to save NEW token → conflicts with invalidation
  // By clearing the old token first, we ensure axios interceptor skips auto-refresh
  const hadOldToken = !!localStorage.getItem('token');

  if (hadOldToken) {
    Log.info('[Auth] signInWithUrl: clearing old token to prevent race condition');
    localStorage.removeItem('token');
  }

  Log.info('[Auth] signInWithUrl: verifying token with AppFlowy Cloud');
  try {
    await verifyToken(accessToken);
  } catch (e) {
    Log.error('[Auth] signInWithUrl: verifyToken failed', { message: (e as Error)?.message });
    return Promise.reject({
      code: -1,
      message: 'Verify token failed',
    });
  }

  Log.info('[Auth] signInWithUrl: refreshing token');
  try {
    await refreshToken(refresh_token);
  } catch (e) {
    Log.error('[Auth] signInWithUrl: refreshToken failed', { message: (e as Error)?.message });
    return Promise.reject({
      code: -1,
      message: 'Refresh token failed',
    });
  }

  Log.info('[Auth] signInWithUrl: OAuth callback processed successfully');
}

export async function verifyToken(accessToken: string) {
  const url = `/api/user/verify/${accessToken}`;

  return executeAPIRequest<{ is_new: boolean }>(() =>
    getAxios()?.get<APIResponse<{ is_new: boolean }>>(url)
  );
}

export async function getServerInfo(): Promise<ServerInfo> {
  const url = '/api/server-info';

  try {
    return await executeAPIRequest<ServerInfo>(() =>
      getAxios()?.get<APIResponse<ServerInfo>>(url)
    );
  } catch (error) {
    console.warn('Server info API returned error:', (error as APIError)?.message);
    return { enable_page_history: true, ai_enabled: true };
  }
}

export async function getAuthProviders(): Promise<AuthProvider[]> {
  const url = '/api/server-info/auth-providers';

  try {
    const payload = await executeAPIRequest<{
      count: number;
      providers: string[];
      signup_disabled: boolean;
      mailer_autoconfirm: boolean;
    }>(() =>
      getAxios()?.get<APIResponse<{
        count: number;
        providers: string[];
        signup_disabled: boolean;
        mailer_autoconfirm: boolean;
      }>>(url)
    );

    return mapAuthProviders(payload.providers);
  } catch (error) {
    const message = (error as APIError)?.message;

    console.warn('Auth providers API returned error:', message);
    console.error('Failed to fetch auth providers:', error);

    // Fallback for self-hosted deployments where /api/server-info/auth-providers
    // is not available: read provider flags directly from GoTrue settings.
    try {
      const settings = (await getGoTrueSettings()) as GoTrueSettingsPayload;
      const enabledExternalProviders = Object.entries(settings.external || {})
        .filter(([, enabled]) => enabled === true)
        .map(([provider]) => provider);

      if (settings.saml_enabled) {
        enabledExternalProviders.push('saml');
      }

      const uniqueProviders = Array.from(new Set(enabledExternalProviders));
      const mappedProviders = mapAuthProviders(uniqueProviders);

      if (mappedProviders.length > 0) {
        return mappedProviders;
      }
    } catch (fallbackError) {
      console.error('Failed to fetch auth providers from GoTrue settings fallback:', fallbackError);
    }

    return [AuthProvider.PASSWORD];
  }
}
