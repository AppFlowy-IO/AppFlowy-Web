import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthService } from '@/application/services/domains';
import { parseGoTrueError } from '@/application/services/js-services/http/gotrue-error';
import { SignUpPassword } from '@/components/login/SignUpPassword';
import { ChangePassword } from '@/components/login/ChangePassword';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key === 'changePassword.passwordErrorMatch' ? 'Passwords differ' : key }),
  Trans: () => null,
}));
jest.mock('@/application/services/domains', () => ({ AuthService: { signUpWithPassword: jest.fn(), changePassword: jest.fn() } }));
jest.mock('@/components/main/app.hooks', () => ({ useIsAuthenticatedOptional: () => true }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

it.each([
  ['weak_password', 'Your new password is too weak.'],
  ['signup_disabled', 'Sign-ups are disabled. Contact your administrator to request access.'],
  ['email_exists', 'signUp.emailAlreadyRegistered'],
  ['unknown_validation', 'Error 422: signUp.signUpFailed'],
])('shows the specific 422 signup reason for %s', async (error_code, expected) => {
  const diagnostic = 'private authentication diagnostic';

  jest.mocked(AuthService.signUpWithPassword).mockRejectedValueOnce(
    parseGoTrueError({ status: 422, error_code, msg: diagnostic })
  );
  render(<SignUpPassword redirectTo='/app' />);
  fireEvent.change(screen.getByTestId('signup-email-input'), { target: { value: 'user@example.com' } });
  fireEvent.change(screen.getByTestId('signup-password-input'), { target: { value: 'Example-password123!' } });
  fireEvent.change(screen.getByTestId('signup-confirm-password-input'), { target: { value: 'Example-password123!' } });
  fireEvent.click(screen.getByTestId('signup-submit-button'));

  await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
  expect(screen.queryByText(diagnostic)).toBeNull();
  if (error_code !== 'email_exists') expect(screen.queryByText('signUp.emailAlreadyRegistered')).toBeNull();
});

it.each(['signup', 'change'])('keeps server wording separate from %s password-confirmation validation', async (form) => {
  const publicMessage = 'The account does not match this request. Contact your administrator.';
  const error = parseGoTrueError({ status: 400, msg: 'Private authentication diagnostic',
    user_error: { schema_version: 1, reason: 'AUTH_REQUEST_PROBLEM', message: publicMessage, locale: 'en' } });

  jest.mocked(AuthService.signUpWithPassword).mockRejectedValueOnce(error);
  jest.mocked(AuthService.changePassword).mockRejectedValueOnce(error);
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {form === 'signup' ? <SignUpPassword redirectTo='/app' /> : <ChangePassword email='user@example.com' redirectTo='/app' />}
  </MemoryRouter>);
  const password = screen.getByPlaceholderText('changePassword.placeholder');
  const confirm = screen.getByPlaceholderText(form === 'signup' ? 'signUp.repeatPasswordHint' : 'changePassword.confirmPassword');

  if (form === 'signup') fireEvent.change(screen.getByTestId('signup-email-input'), { target: { value: 'user@example.com' } });
  fireEvent.change(password, { target: { value: 'Example-password123!' } });
  fireEvent.change(confirm, { target: { value: 'Example-password123!' } });
  fireEvent.click(screen.getByRole('button', { name: form === 'signup' ? 'signUp.buttonText' : 'changePassword.submit' }));

  await screen.findByText(`Error 400: ${publicMessage}`);
  expect(confirm.parentElement?.classList.contains('border-border-error-thick')).toBe(false);

  fireEvent.change(confirm, { target: { value: 'Different-password123!' } });
  fireEvent.blur(confirm);
  expect(screen.getByText('Passwords differ')).toBeTruthy();
  expect(confirm.parentElement?.classList.contains('border-border-error-thick')).toBe(true);
});
