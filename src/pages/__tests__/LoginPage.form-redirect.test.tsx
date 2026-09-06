import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import {
  getPublicFormRedirectTo,
  PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS,
  savePublicFormRedirectTo,
} from '@/application/session/sign_in';
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

describe('LoginPage Form return path', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(window.history.state, '', '/');
    mockUseIsAuthenticatedOptional.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the token-free stored destination when the login URL carries its flow ID', () => {
    const destination = '/form/form-token';
    const flowId = savePublicFormRedirectTo(destination);

    renderLoginPage(`/login?force=true&formAuth=${flowId}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe(destination);
  });

  it('does not resume an abandoned Form flow from a later plain login', () => {
    savePublicFormRedirectTo('/form/form-token');

    renderLoginPage('/login');

    expect(screen.getByTestId('login-redirect').textContent).toBe('');
    expect(window.sessionStorage.getItem('publicFormAuthContinuation')).toBeNull();
  });

  it('prefers an explicit safe redirect query over a stored destination', () => {
    savePublicFormRedirectTo('/form/form-token');

    renderLoginPage('/login?redirectTo=%2Fsettings');

    expect(screen.getByTestId('login-redirect').textContent).toBe('/settings');
    expect(getPublicFormRedirectTo()).toBeNull();
    expect(window.localStorage.getItem('redirectTo')).toBe('/settings');
  });

  it('does not use an unsafe stored destination', () => {
    window.localStorage.setItem('redirectTo', 'https://evil.example/form/form-token');

    renderLoginPage('/login');

    expect(screen.getByTestId('login-redirect').textContent).toBe('');
    expect(window.localStorage.getItem('redirectTo')).toBeNull();
  });

  it('moves a legacy Form redirect query into storage and replaces it in the address bar', () => {
    renderLoginPage('/login?redirectTo=%2Fform%2Fform-token&force=true');

    expect(screen.getByTestId('login-redirect').textContent).toBe('/form/form-token');
    const search = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');

    expect(search.get('force')).toBe('true');
    expect(search.get('formAuth')).toMatch(/^[a-f0-9]{32}$/);
    expect(window.localStorage.getItem('redirectTo')).toBeNull();
  });

  it('does not fall back to stale storage when an explicit redirect query is unsafe', () => {
    savePublicFormRedirectTo('/form/stale-token');

    renderLoginPage('/login?redirectTo=https%3A%2F%2Fevil.example%2Fform');

    expect(screen.getByTestId('login-redirect').textContent).toBe('');
    expect(screen.getByTestId('location-search').textContent).toBe('');
    expect(window.localStorage.getItem('redirectTo')).toBeNull();
  });

  it('keeps the forced login screen visible for a cached authenticated session', () => {
    const flowId = savePublicFormRedirectTo('/form/form-token');

    mockUseIsAuthenticatedOptional.mockReturnValue(true);

    renderLoginPage(`/login?force=true&formAuth=${flowId}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe('/form/form-token');
    expect(getPublicFormRedirectTo()).toBe('/form/form-token');
  });

  it('does not reuse an expired Form continuation', () => {
    const flowId = savePublicFormRedirectTo(
      '/form/form-token',
      Date.now() - PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS - 1
    );

    renderLoginPage(`/login?force=true&formAuth=${flowId}`);

    expect(screen.getByTestId('login-redirect').textContent).toBe('');
    expect(getPublicFormRedirectTo()).toBeNull();
  });

  it('expires a Form continuation while the login page remains open', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const flowId = savePublicFormRedirectTo('/form/form-token');

    renderLoginPage(`/login?force=true&formAuth=${flowId}`);
    expect(screen.getByTestId('login-redirect').textContent).toBe('/form/form-token');

    act(() => {
      jest.advanceTimersByTime(PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS + 1);
    });

    expect(screen.getByTestId('login-redirect').textContent).toBe('');
    expect(getPublicFormRedirectTo()).toBeNull();
  });
});
