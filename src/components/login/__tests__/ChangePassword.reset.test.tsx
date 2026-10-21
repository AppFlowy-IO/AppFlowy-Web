import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';

import { AuthService } from '@/application/services/domains';
import { invalidToken } from '@/application/session/token';
import { ChangePassword } from '@/components/login/ChangePassword';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), Trans: () => null }));
jest.mock('@/application/services/domains', () => ({
  AuthService: { changePassword: jest.fn(), resetPassword: jest.fn() },
}));
jest.mock('@/application/session/token', () => ({ invalidToken: jest.fn() }));
jest.mock('@/components/main/app.hooks', () => ({ useIsAuthenticatedOptional: () => true }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

it('resets a forgotten password without asking for the current one', async () => {
  jest.mocked(AuthService.resetPassword).mockResolvedValueOnce(undefined);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ChangePassword email='user@example.com' redirectTo='/app' />
    </MemoryRouter>
  );

  fireEvent.change(screen.getByPlaceholderText('changePassword.placeholder'), {
    target: { value: 'Reset-password123!' },
  });
  fireEvent.change(screen.getByPlaceholderText('changePassword.confirmPassword'), {
    target: { value: 'Reset-password123!' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'changePassword.submit' }));

  await waitFor(() => expect(invalidToken).toHaveBeenCalledTimes(1));
  expect(AuthService.resetPassword).toHaveBeenCalledWith({ password: 'Reset-password123!' });
  expect(AuthService.changePassword).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith('changePassword.success');
});
