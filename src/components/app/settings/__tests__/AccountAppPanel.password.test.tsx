import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthService } from '@/application/services/domains';
import type { GoTrueUserAuthInfo } from '@/application/services/js-services/http/gotrue';
import { AccountAppPanel } from '@/components/app/settings/AccountAppPanel';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/i18n/config', () => ({ i18nInstance: { language: 'en', changeLanguage: jest.fn() } }));
jest.mock('@/components/main/app.hooks', () => ({
  useAppConfig: () => ({ currentUser: { metadata: {} }, updateCurrentUser: jest.fn() }),
}));
jest.mock('@/application/services/domains', () => ({
  AuthService: { changePassword: jest.fn(), getUserAuthInfo: jest.fn() },
  UserService: { getCurrentRaw: jest.fn(async () => undefined), updateProfile: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const getUserAuthInfo = jest.mocked(AuthService.getUserAuthInfo);
const changePassword = jest.mocked(AuthService.changePassword);
const authInfo = (is_non_default_password: boolean): GoTrueUserAuthInfo => ({
  has_password: true,
  is_sso_user: false,
  is_non_default_password,
});

const renderPanel = () =>
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountAppPanel />
    </MemoryRouter>
  );

beforeEach(() => {
  getUserAuthInfo.mockReset();
  changePassword.mockReset();
});

it('offers to change the password once the user has chosen one', async () => {
  getUserAuthInfo.mockResolvedValueOnce(authInfo(true));
  renderPanel();

  await waitFor(() =>
    expect(screen.getByTestId('setup-password-button').textContent).toBe('settings.accountPage.password.changeButton')
  );
  fireEvent.click(screen.getByTestId('setup-password-button'));
  expect(screen.getByLabelText('settings.accountPage.password.currentPassword')).toBeTruthy();
});

it('keeps the setup flow when auth-info is unavailable', async () => {
  getUserAuthInfo.mockRejectedValueOnce({ code: 404, sourceDomain: 'gotrue' });
  renderPanel();

  await waitFor(() => expect(getUserAuthInfo).toHaveBeenCalled());
  expect(screen.getByTestId('setup-password-button').textContent).toBe('settings.accountPage.password.setupButton');
});

it('ignores a slow first read that finishes after the post-change refresh', async () => {
  let resolveFirstRead!: (info: GoTrueUserAuthInfo) => void;

  getUserAuthInfo
    .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstRead = resolve)))
    .mockResolvedValueOnce(authInfo(true));
  changePassword.mockResolvedValueOnce(undefined);
  renderPanel();

  fireEvent.click(screen.getByTestId('setup-password-button'));
  fireEvent.change(screen.getByLabelText('changePassword.newPassword'), { target: { value: 'Example-password123!' } });
  fireEvent.change(screen.getByLabelText('changePassword.confirmPassword'), {
    target: { value: 'Example-password123!' },
  });
  fireEvent.click(screen.getByTestId('setup-password-submit'));

  const button = screen.getByTestId('setup-password-button');

  await waitFor(() => expect(button.textContent).toBe('settings.accountPage.password.changeButton'));
  await act(async () => resolveFirstRead(authInfo(false)));
  expect(button.textContent).toBe('settings.accountPage.password.changeButton');
});
