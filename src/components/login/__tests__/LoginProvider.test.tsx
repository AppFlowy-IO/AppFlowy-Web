import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AuthProvider } from '@/application/types';
import LoginProvider from '../LoginProvider';

type TranslationOptions = {
  provider?: string;
  interpolation?: { escapeValue?: boolean };
};

function escapeInterpolation(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

const mockTranslate = jest.fn((key: string, options?: TranslationOptions) => {
  if (key !== 'web.continueWithProvider') return key;

  const provider = options?.provider ?? '';
  const renderedProvider = options?.interpolation?.escapeValue === false ? provider : escapeInterpolation(provider);

  return `Continue with ${renderedProvider}`;
});

const mockSignInLdap = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('@/application/services/domains', () => ({
  AuthService: {
    signInLdap: (...args: unknown[]) => mockSignInLdap(...args),
  },
}));

describe('LoginProvider', () => {
  beforeEach(() => {
    mockSignInLdap.mockReset();
    mockSignInLdap.mockResolvedValue();
  });

  it('renders a custom provider name without HTML entities', () => {
    const providerName = "R&D's <SSO>";

    render(
      <LoginProvider
        redirectTo='/app'
        availableProviders={['custom:rd-sso']}
        customProviders={[{ identifier: 'custom:rd-sso', name: providerName }]}
      />
    );

    expect(screen.getByRole('button', { name: `Continue with ${providerName}` })).toBeDefined();
    expect(mockTranslate).toHaveBeenCalledWith('web.continueWithProvider', {
      provider: providerName,
      interpolation: { escapeValue: false },
    });
  });

  it('renders and routes each named LDAP connection', async () => {
    render(
      <LoginProvider
        redirectTo='/app'
        availableProviders={[AuthProvider.LDAP]}
        ldapProviders={[
          { id: 'corp-directory-id', name: 'Corporate Directory' },
          { id: 'partner-directory-id', name: 'Partner Directory' },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'Continue with Corporate Directory' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Continue with Partner Directory' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'web.continueWithLdap' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Partner Directory' }));
    fireEvent.change(screen.getByLabelText('web.ldapUsernamePlaceholder'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText('web.ldapPasswordPlaceholder'), {
      target: { value: 'alice-secret-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'web.continue' }));

    await waitFor(() => {
      expect(mockSignInLdap).toHaveBeenCalledWith({
        username: 'alice@example.com',
        password: 'alice-secret-pw',
        connectionId: 'partner-directory-id',
        redirectTo: '/app',
      });
    });
  });

  it('keeps one generic LDAP choice for a legacy server without metadata', () => {
    render(<LoginProvider redirectTo='/app' availableProviders={[AuthProvider.LDAP]} />);

    expect(screen.getAllByRole('button', { name: 'web.continueWithLdap' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Continue with LDAP' })).toBeNull();
  });
});
