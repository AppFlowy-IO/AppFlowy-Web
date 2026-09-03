import { beginPublicFormAuthentication, getPublicFormAuthUrl } from '@/application/session/public_form_auth';
import { getPublicFormRedirectTo } from '@/application/session/sign_in';

describe('public Form authentication continuation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(window.history.state, '', '/');
  });

  it('builds token-free forced login and signup destinations', () => {
    expect(getPublicFormAuthUrl('login')).toBe('/login?force=true');
    expect(getPublicFormAuthUrl('signUp')).toBe('/login?action=signUpPassword&force=true');
  });

  it.each(['login', 'signUp'] as const)('stores the Form path before starting %s', (mode) => {
    const navigate = jest.fn();

    beginPublicFormAuthentication('267699aa-58ef-452f-b822-57271c2c218d', mode, navigate);

    const loginUrl = new URL(navigate.mock.calls[0][0], window.location.origin);

    window.history.replaceState(window.history.state, '', loginUrl);
    expect(getPublicFormRedirectTo()).toBe('/form/267699aa-58ef-452f-b822-57271c2c218d');
    expect(window.localStorage.length).toBe(0);
    expect(loginUrl.pathname).toBe('/login');
    expect(loginUrl.searchParams.get('force')).toBe('true');
    expect(loginUrl.searchParams.get('formAuth')).toMatch(/^[a-f0-9]{32}$/);
    expect(loginUrl.searchParams.get('action')).toBe(mode === 'signUp' ? 'signUpPassword' : null);
    expect(loginUrl.toString()).not.toContain('267699aa-58ef-452f-b822-57271c2c218d');
  });

  it('redacts the Form bearer from the current history entry before navigating', () => {
    window.history.replaceState(window.history.state, '', '/form/267699aa-58ef-452f-b822-57271c2c218d');
    const navigate = jest.fn();

    beginPublicFormAuthentication('267699aa-58ef-452f-b822-57271c2c218d', 'login', navigate);

    expect(window.location.pathname).toBe('/form');
    expect(window.location.href).not.toContain('267699aa-58ef-452f-b822-57271c2c218d');
  });
});
