import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { MCP_CONSENT_AUTH_CONTINUATION_TTL_MS, saveMcpConsentRedirectTo } from '@/application/session/sign_in';
import { useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import LoginPage from '@/pages/LoginPage';

jest.mock('@/components/login', () => ({
  Login: ({ redirectTo }: { redirectTo: string }) => <div data-testid='login-redirect'>{redirectTo}</div>,
}));

jest.mock('@/components/login/ChangePassword', () => ({ ChangePassword: () => null }));
jest.mock('@/components/login/CheckEmail', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/login/CheckEmailResetPassword', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/login/EnterPassword', () => ({ EnterPassword: () => null }));
jest.mock('@/components/login/ForgotPassword', () => ({ ForgotPassword: () => null }));
jest.mock('@/components/login/SignUpPassword', () => ({ SignUpPassword: () => null }));
jest.mock('@/components/main/app.hooks', () => ({ useIsAuthenticatedOptional: jest.fn() }));

const mockUseIsAuthenticatedOptional = useIsAuthenticatedOptional as jest.MockedFunction<
  typeof useIsAuthenticatedOptional
>;

const CONSENT_PATH =
  '/oauth/mcp/authorize?client_id=dcr-client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2Fcallback' +
  '&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';

function LocationProbe() {
  const location = useLocation();

  return <div data-testid='location-search'>{location.search}</div>;
}

function renderLoginPage(entry: string) {
  window.history.replaceState(window.history.state, '', entry);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('LoginPage MCP consent return path', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(window.history.state, '', '/');
    mockUseIsAuthenticatedOptional.mockReturnValue(false);
  });

  it('signs in towards the stored consent request when the login URL carries its flow ID', () => {
    const flowId = saveMcpConsentRedirectTo(CONSENT_PATH);

    renderLoginPage(`/login?force=true&mcpAuth=${flowId}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe(CONSENT_PATH);
    expect(window.localStorage.getItem('redirectTo')).toBeNull();
  });

  it('keeps an expired consent request bound to the login, so sign-in can report that it expired', () => {
    const flowId = saveMcpConsentRedirectTo(CONSENT_PATH, Date.now() - MCP_CONSENT_AUTH_CONTINUATION_TTL_MS - 1);

    renderLoginPage(`/login?force=true&mcpAuth=${flowId}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe(CONSENT_PATH);
  });

  it('does not resume an abandoned consent request from a later plain login', () => {
    saveMcpConsentRedirectTo(CONSENT_PATH);

    renderLoginPage('/login');

    expect(screen.getByTestId('login-redirect').textContent).toBe('');
    expect(window.sessionStorage.getItem('mcpConsentAuthContinuation')).toBeNull();
  });

  it('moves a consent request out of a legacy redirect query into an expiring flow', () => {
    renderLoginPage(`/login?redirectTo=${encodeURIComponent(CONSENT_PATH)}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe(CONSENT_PATH);
    const search = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');

    expect(search.get('redirectTo')).toBeNull();
    expect(search.get('force')).toBe('true');
    expect(search.get('mcpAuth')).toMatch(/^[a-f0-9]{32}$/);
    expect(window.localStorage.getItem('redirectTo')).toBeNull();

    const stored = JSON.parse(window.sessionStorage.getItem('mcpConsentAuthContinuation') ?? '{}');

    expect(stored.redirectTo).toBe(CONSENT_PATH);
    expect(stored.flowId).toBe(search.get('mcpAuth'));
  });

  it('keeps the login screen for a cached session (e.g. while switching accounts)', () => {
    const flowId = saveMcpConsentRedirectTo(CONSENT_PATH);

    mockUseIsAuthenticatedOptional.mockReturnValue(true);
    renderLoginPage(`/login?force=true&mcpAuth=${flowId}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe(CONSENT_PATH);
    expect(window.location.pathname).toBe('/login');
    expect(window.sessionStorage.getItem('mcpConsentAuthContinuation')).not.toBeNull();
  });
});
