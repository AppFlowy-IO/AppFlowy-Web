import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AuthService } from '@/application/services/domains';
import { parseGoTrueError } from '@/application/services/js-services/http/gotrue-error';
import { SetupPasswordDialog } from '@/components/app/settings/SetupPasswordDialog';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ AuthService: { changePassword: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const NEW_PASSWORD = 'Example-password123!';
const CURRENT_PASSWORD = 'Current-password123!';
const changePassword = jest.mocked(AuthService.changePassword);

function renderDialog(requireCurrentPassword?: boolean) {
  const onClose = jest.fn();
  const onSuccess = jest.fn();

  render(
    <SetupPasswordDialog
      open
      requireCurrentPassword={requireCurrentPassword}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );

  return { onClose, onSuccess };
}

function fillNewPassword() {
  fireEvent.change(screen.getByLabelText('changePassword.newPassword'), { target: { value: NEW_PASSWORD } });
  fireEvent.change(screen.getByLabelText('changePassword.confirmPassword'), { target: { value: NEW_PASSWORD } });
}

const submitButton = () => screen.getByTestId<HTMLButtonElement>('setup-password-submit');
const incorrectCurrentPassword = () =>
  parseGoTrueError({ status: 422, error_code: 'incorrect_current_password', msg: 'Incorrect current password' });

beforeEach(() => {
  changePassword.mockReset();
});

it('sets a first password without asking for a current one', async () => {
  changePassword.mockResolvedValueOnce(undefined);
  const { onClose, onSuccess } = renderDialog();

  expect(screen.queryByLabelText('settings.accountPage.password.currentPassword')).toBeNull();
  fillNewPassword();
  fireEvent.click(submitButton());

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(changePassword).toHaveBeenCalledWith({ password: NEW_PASSWORD, currentPassword: undefined });
  expect(onSuccess).toHaveBeenCalled();
});

it('sends the current password when the user already chose one', async () => {
  changePassword.mockResolvedValueOnce(undefined);
  const { onClose } = renderDialog(true);

  expect(screen.getByRole('dialog').textContent).toContain('settings.accountPage.password.changeButton');
  fillNewPassword();
  expect(submitButton().disabled).toBe(true);

  fireEvent.change(screen.getByLabelText('settings.accountPage.password.currentPassword'), {
    target: { value: CURRENT_PASSWORD },
  });
  fireEvent.click(submitButton());

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(changePassword).toHaveBeenCalledWith({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });
});

it('shows a wrong current password on its field and keeps the dialog open', async () => {
  changePassword.mockRejectedValueOnce(incorrectCurrentPassword());
  const { onClose, onSuccess } = renderDialog(true);

  fireEvent.change(screen.getByLabelText('settings.accountPage.password.currentPassword'), {
    target: { value: 'Wrong-password123!' },
  });
  fillNewPassword();
  fireEvent.click(submitButton());

  await screen.findByText('userError.CURRENT_PASSWORD_INCORRECT');
  expect(screen.queryByText(/Error 422/)).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
});

it('asks for the current password when GoTrue requires one the panel did not know about', async () => {
  changePassword.mockRejectedValueOnce(incorrectCurrentPassword()).mockResolvedValueOnce(undefined);
  const { onClose } = renderDialog(false);

  fillNewPassword();
  fireEvent.click(submitButton());

  await screen.findByText('settings.accountPage.password.currentPasswordRequired');
  const currentPassword = screen.getByLabelText('settings.accountPage.password.currentPassword');

  expect(document.activeElement).toBe(currentPassword);
  expect(submitButton().disabled).toBe(true);

  fireEvent.change(currentPassword, { target: { value: CURRENT_PASSWORD } });
  fireEvent.click(submitButton());

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(changePassword).toHaveBeenLastCalledWith({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });
});

it('keeps other GoTrue reasons as a form error', async () => {
  changePassword.mockRejectedValueOnce(
    parseGoTrueError({ status: 422, error_code: 'same_password', msg: 'New password should be different.' })
  );
  renderDialog(true);

  fireEvent.change(screen.getByLabelText('settings.accountPage.password.currentPassword'), {
    target: { value: NEW_PASSWORD },
  });
  fillNewPassword();
  fireEvent.click(submitButton());

  await screen.findByText('Your new password must be different from your current password.');
  expect(screen.queryByText('userError.CURRENT_PASSWORD_INCORRECT')).toBeNull();
});
