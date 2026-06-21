import { AuthProvider } from '@/application/types';
import { Log } from '@/utils/log';

import { verifyAndRefreshGoTrueToken } from './gotrue';
import { parseGoTrueErrorFromUrl } from './gotrue-error';
import { APIError, APIResponse, executeAPIRequest, getAxios } from './core';

export { verifyToken } from './cloud-auth';

export interface ServerInfo {
  enable_page_history: boolean;
  ai_enabled?: boolean;
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

  return verifyAndRefreshGoTrueToken({
    accessToken,
    refreshToken: refresh_token,
    logContext: 'signInWithUrl',
    verifyErrorMessage: 'Verify token failed',
    refreshErrorMessage: 'Refresh token failed',
    useVerifyErrorMessage: false,
  });
}

export async function getServerInfo(): Promise<ServerInfo> {
  const url = '/api/server-info';

  try {
    return await executeAPIRequest<ServerInfo>(() =>
      getAxios()?.get<APIResponse<ServerInfo>>(url, {
        headers: {
          'x-platform': 'web',
        },
      })
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

    return payload.providers
      .map((provider: string) => {
        switch (provider.toLowerCase()) {
          case 'google':
            return AuthProvider.GOOGLE;
          case 'apple':
            return AuthProvider.APPLE;
          case 'github':
            return AuthProvider.GITHUB;
          case 'discord':
            return AuthProvider.DISCORD;
          case 'email':
            return AuthProvider.EMAIL;
          case 'password':
            return AuthProvider.PASSWORD;
          case 'magic_link':
            return AuthProvider.MAGIC_LINK;
          case 'saml':
            return AuthProvider.SAML;
          case 'phone':
            return AuthProvider.PHONE;
          default:
            console.warn(`Unknown auth provider from server: ${provider}`);
            return null;
        }
      })
      .filter((provider): provider is AuthProvider => provider !== null);
  } catch (error) {
    const message = (error as APIError)?.message;

    console.warn('Auth providers API returned error:', message);
    console.error('Failed to fetch auth providers:', error);
    return [AuthProvider.PASSWORD];
  }
}
