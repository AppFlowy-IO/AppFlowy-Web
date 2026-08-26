import { AuthProvider } from '@/application/types';
import {
  getLoginProvidersCacheKey,
  readCachedLoginProviders,
  writeCachedLoginProviders,
} from '@/components/login/loginProvidersCache';

describe('loginProvidersCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips the last server-confirmed provider configuration', () => {
    const providers = {
      providers: [AuthProvider.GOOGLE, AuthProvider.SAML, 'custom:okta' as const],
      customProviders: [{ identifier: 'custom:okta' as const, name: 'Okta' }],
      ldapProviders: [{ id: 'corp', name: 'Corporate Directory' }],
    };

    writeCachedLoginProviders(providers);

    expect(readCachedLoginProviders()).toEqual(providers);
  });

  it('rejects and removes malformed local data', () => {
    const cacheKey = getLoginProvidersCacheKey();

    localStorage.setItem(
      cacheKey,
      JSON.stringify({ providers: ['untrusted-provider'], customProviders: [], ldapProviders: [] })
    );

    expect(readCachedLoginProviders()).toBeNull();
    expect(localStorage.getItem(cacheKey)).toBeNull();
  });
});
