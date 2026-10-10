import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AuthService } from '@/application/services/domains';
import { parseGoTrueError } from '@/application/services/js-services/http/gotrue-error';
import { SignUpPassword } from '@/components/login/SignUpPassword';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ AuthService: { signUpWithPassword: jest.fn() } }));
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
