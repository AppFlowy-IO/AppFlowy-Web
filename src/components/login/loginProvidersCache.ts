import {
  AuthProvider,
  CUSTOM_PROVIDER_PREFIX,
  type CustomAuthProviderId,
  type LoginProviderId,
  type LoginProviders,
} from '@/application/types';
import { getConfigValue } from '@/utils/runtime-config';

const LOGIN_PROVIDERS_CACHE_PREFIX = 'appflowy:login-providers:v1';
const BUILT_IN_PROVIDER_IDS = new Set<string>(Object.values(AuthProvider));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCustomLoginProviderId(value: unknown): value is CustomAuthProviderId {
  return (
    typeof value === 'string' && value.startsWith(CUSTOM_PROVIDER_PREFIX) && value.length > CUSTOM_PROVIDER_PREFIX.length
  );
}

function isLoginProviderId(value: unknown): value is LoginProviderId {
  return (typeof value === 'string' && BUILT_IN_PROVIDER_IDS.has(value)) || isCustomLoginProviderId(value);
}

function parseLoginProviders(value: unknown): LoginProviders | null {
  if (!isRecord(value)) return null;

  const { providers, customProviders, ldapProviders } = value;

  if (!Array.isArray(providers) || !providers.every(isLoginProviderId)) return null;
  if (
    !Array.isArray(customProviders) ||
    !customProviders.every(
      (provider) =>
        isRecord(provider) && isCustomLoginProviderId(provider.identifier) && typeof provider.name === 'string'
    )
  ) {
    return null;
  }

  if (
    !Array.isArray(ldapProviders) ||
    !ldapProviders.every(
      (provider) =>
        isRecord(provider) &&
        typeof provider.id === 'string' &&
        provider.id.trim().length > 0 &&
        typeof provider.name === 'string'
    )
  ) {
    return null;
  }

  return {
    providers: [...providers],
    customProviders: customProviders.map((provider) => ({
      identifier: provider.identifier as CustomAuthProviderId,
      name: provider.name as string,
    })),
    ldapProviders: ldapProviders.map((provider) => ({
      id: provider.id as string,
      name: provider.name as string,
    })),
  };
}

export function getLoginProvidersCacheKey(): string {
  const backend = getConfigValue('APPFLOWY_BASE_URL', '').trim() || 'same-origin';

  return `${LOGIN_PROVIDERS_CACHE_PREFIX}:${encodeURIComponent(backend)}`;
}

/** Read the last server-confirmed deployment configuration for the first paint. */
export function readCachedLoginProviders(): LoginProviders | null {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window.localStorage;
    const cacheKey = getLoginProvidersCacheKey();
    const serialized = storage.getItem(cacheKey);

    if (!serialized) return null;

    const providers = parseLoginProviders(JSON.parse(serialized));

    if (!providers) storage.removeItem(cacheKey);

    return providers;
  } catch {
    return null;
  }
}

/** Cache only validated server data; authentication remains server-enforced. */
export function writeCachedLoginProviders(providers: LoginProviders): void {
  if (typeof window === 'undefined') return;

  const validatedProviders = parseLoginProviders(providers);

  if (!validatedProviders) return;

  try {
    window.localStorage.setItem(getLoginProvidersCacheKey(), JSON.stringify(validatedProviders));
  } catch {
    // Storage can be disabled or full. The network result still drives the UI.
  }
}
