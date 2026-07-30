import {
  AuthProvider,
  CUSTOM_PROVIDER_PREFIX,
  CustomAuthProviderId,
  LdapAuthProvider,
  LoginProviderId,
  LoginProviders,
} from '@/application/types';
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

/**
 * Sign in against a configured LDAP directory.
 *
 * Unlike the browser-based providers there is no redirect: AppFlowy Cloud
 * performs the bind and mints the session, so the tokens arrive inline and are
 * completed through the same path a password login uses.
 *
 * `username` is matched by the connection's user filter, so it may be a
 * directory login (e.g. `alice`) or an email. New servers advertise connection
 * ids so the user can choose the intended directory; the id remains optional
 * for compatibility with servers that only expose one generic LDAP provider.
 */
export async function signInWithLdap(username: string, password: string, connectionId?: string) {
  const url = '/api/auth/ldap/login';

  Log.info('[Auth] signInWithLdap: starting');

  const data = await executeAPIRequest<{
    access_token: string;
    refresh_token: string;
  }>(
    () =>
      getAxios()?.post<APIResponse<{ access_token: string; refresh_token: string }>>(url, {
        username,
        password,
        ...(connectionId ? { connection_id: connectionId } : {}),
      }),
    { suppressResponseDataLogging: true }
  );

  if (!data?.access_token || !data?.refresh_token) {
    Log.error('[Auth] signInWithLdap: server returned no tokens');
    return Promise.reject({
      code: -1,
      message: 'Failed to sign in with LDAP',
    });
  }

  Log.info('[Auth] signInWithLdap: server returned tokens, completing auth flow');
  return verifyAndRefreshGoTrueToken({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    logContext: 'signInWithLdap',
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

interface AuthProvidersPayload {
  count: number;
  providers: string[];
  signup_disabled: boolean;
  mailer_autoconfirm: boolean;
  custom_providers?: { identifier: string; name: string }[];
  ldap_providers?: { id: string; name: string }[];
}

/**
 * `custom:` on its own names no provider, and GoTrue rejects it at `/authorize`.
 * Screened out here so it can never reach the UI: it would otherwise render as
 * a button labelled "Continue with " that silently does nothing when clicked.
 */
function isUsableCustomProviderId(provider: string): provider is CustomAuthProviderId {
  return provider.startsWith(CUSTOM_PROVIDER_PREFIX) && provider.length > CUSTOM_PROVIDER_PREFIX.length;
}

export async function getAuthProviders(): Promise<LoginProviders> {
  const url = '/api/server-info/auth-providers';

  try {
    const payload = await executeAPIRequest<AuthProvidersPayload>(() =>
      getAxios()?.get<APIResponse<AuthProvidersPayload>>(url)
    );

    const providers = payload.providers
      .map((provider: string): LoginProviderId | null => {
        // Custom OAuth/OIDC identifiers are named per deployment, so they are
        // passed through rather than matched: the server is the only authority
        // on which ones exist. A bare `custom:` falls through to the switch and
        // is reported as unknown rather than passed on.
        if (isUsableCustomProviderId(provider)) {
          return provider;
        }

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
          case 'ldap':
            return AuthProvider.LDAP;
          default:
            console.warn(`Unknown auth provider from server: ${provider}`);
            return null;
        }
      })
      .filter((provider): provider is LoginProviderId => provider !== null);

    // A missing name stays missing rather than being backfilled with the
    // identifier: the identifier is not a display name, and substituting it
    // here would mask the absence from the caller, which has a better fallback.
    const customProviders = (payload.custom_providers ?? [])
      .filter((provider) => isUsableCustomProviderId(provider?.identifier ?? ''))
      .map((provider) => ({
        identifier: provider.identifier as CustomAuthProviderId,
        name: provider.name?.trim() ?? '',
      }));

    const ldapProviderIds = new Set<string>();
    const ldapProviders = (payload.ldap_providers ?? []).reduce<LdapAuthProvider[]>((result, provider) => {
      const id = provider?.id?.trim() ?? '';

      if (!id || ldapProviderIds.has(id)) {
        return result;
      }

      ldapProviderIds.add(id);
      result.push({ id, name: provider.name?.trim() ?? '' });
      return result;
    }, []);

    // Deduplicated because each entry becomes a React key downstream: a server
    // that lists one provider twice would otherwise render sibling elements
    // sharing a key.
    return { providers: [...new Set(providers)], customProviders, ldapProviders };
  } catch (error) {
    const message = (error as APIError)?.message;

    console.warn('Auth providers API returned error:', message);
    console.error('Failed to fetch auth providers:', error);
    return { providers: [AuthProvider.PASSWORD], customProviders: [], ldapProviders: [] };
  }
}
