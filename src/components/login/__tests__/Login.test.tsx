import { act, render, screen, waitFor } from '@testing-library/react';

import { AuthProvider, type LoginProviders } from '@/application/types';
import Login from '@/components/login/Login';
import { getLoginProvidersCacheKey, writeCachedLoginProviders } from '@/components/login/loginProvidersCache';

const mockGetAuthProviders = jest.fn<Promise<LoginProviders>, []>();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  AuthService: {
    getAuthProviders: () => mockGetAuthProviders(),
  },
}));

jest.mock('@/components/login/EmailLogin', () => ({
  __esModule: true,
  default: () => <div data-testid='email-login' />,
}));

jest.mock('@/components/login/LoginProvider', () => ({
  __esModule: true,
  default: ({ availableProviders = [] }: { availableProviders?: string[] }) => (
    <div data-testid='login-providers'>{availableProviders.join(',')}</div>
  ),
}));

jest.mock('@/utils/platform', () => ({
  getPlatform: () => ({ isMobile: false }),
}));

describe('Login provider first paint', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAuthProviders.mockReset();
  });

  it('renders cached providers immediately and revalidates them in the background', async () => {
    let resolveProviders!: (providers: LoginProviders) => void;
    const cachedProviders: LoginProviders = {
      providers: [AuthProvider.GOOGLE, AuthProvider.SAML],
      customProviders: [],
      ldapProviders: [],
    };
    const refreshedProviders: LoginProviders = {
      providers: [AuthProvider.GOOGLE],
      customProviders: [],
      ldapProviders: [],
    };

    writeCachedLoginProviders(cachedProviders);
    mockGetAuthProviders.mockReturnValue(
      new Promise((resolve) => {
        resolveProviders = resolve;
      })
    );

    render(<Login redirectTo='/app' />);

    expect(screen.getByTestId('login-providers').textContent).toBe('google,saml');

    await act(async () => {
      resolveProviders(refreshedProviders);
    });

    await waitFor(() => expect(screen.getByTestId('login-providers').textContent).toBe('google'));
    expect(JSON.parse(localStorage.getItem(getLoginProvidersCacheKey()) ?? 'null')).toEqual(refreshedProviders);
  });
});
