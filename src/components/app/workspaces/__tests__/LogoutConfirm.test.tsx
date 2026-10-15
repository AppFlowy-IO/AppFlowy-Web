import { fireEvent, render, screen } from '@testing-library/react';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';

import { LogoutConfirm } from '../LogoutConfirm';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function renderConfirm(open = true) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  const view = render(<LogoutConfirm open={open} onClose={onClose} onConfirm={onConfirm} />);

  return { ...view, onConfirm, onClose };
}

test('logs out and keeps the local copies unless the user chooses to remove them', () => {
  const { onConfirm, onClose } = renderConfirm();
  const choice = screen.getByRole('switch', { name: 'settings.menu.logoutRemoveLocalData' });

  expect(choice.getAttribute('aria-checked')).toBe('false');
  expect(choice.getAttribute('aria-describedby')).toBeTruthy();
  expect(document.getElementById(choice.getAttribute('aria-describedby')!)?.textContent).toBe(
    'settings.menu.logoutRemoveLocalDataDescription'
  );

  fireEvent.click(screen.getByTestId('logout-confirm-button'));

  expect(onConfirm).toHaveBeenCalledWith({ removeLocalData: false });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('passes the explicit choice to remove this browser’s copies', () => {
  const { onConfirm } = renderConfirm();

  fireEvent.click(screen.getByRole('switch', { name: 'settings.menu.logoutRemoveLocalData' }));
  fireEvent.click(screen.getByTestId('logout-confirm-button'));

  expect(onConfirm).toHaveBeenCalledWith({ removeLocalData: true });
});

test('starts unchecked each time the dialog opens', () => {
  const { rerender, onConfirm, onClose } = renderConfirm();

  fireEvent.click(screen.getByRole('switch', { name: 'settings.menu.logoutRemoveLocalData' }));
  rerender(<LogoutConfirm open={false} onClose={onClose} onConfirm={onConfirm} />);
  rerender(<LogoutConfirm open onClose={onClose} onConfirm={onConfirm} />);

  expect(screen.getByRole('switch', { name: 'settings.menu.logoutRemoveLocalData' }).getAttribute('aria-checked')).toBe(
    'false'
  );
});

test('shows only its own buttons, with no empty footer below them', () => {
  renderConfirm();

  // A hidden footer would still add its gap under the buttons.
  expect(screen.getAllByRole('button', { name: 'button.cancel' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'settings.menu.signOut' })).toHaveLength(1);
  expect(screen.queryByTestId('modal-ok-button')).toBeNull();
});

test('says "sign out" in its title, question and button, like the account-only page', () => {
  renderConfirm();

  // Title and button.
  expect(screen.getAllByText('settings.menu.signOut')).toHaveLength(2);
  expect(screen.queryByText('button.logout')).toBeNull();
  expect(en.settings.menu.signOut).toBe(en.workspaceCreation.signOut);
  expect(en.settings.menu.logoutPrompt).toBe('Are you sure you want to sign out?');
  expect(fr.settings.menu.signOut).toBe(fr.workspaceCreation.signOut);
});

test('reads question first: the question is in primary text, above the option', () => {
  renderConfirm();

  expect(screen.getByText('settings.menu.logoutPrompt').className.split(/\s+/)).toContain('text-text-primary');
});

test('says the option removes page copies and that unsent changes stay in this browser', () => {
  expect(en.settings.menu.logoutRemoveLocalData).toBe('Also remove page copies from this browser');
  expect(en.settings.menu.logoutRemoveLocalDataDescription).toBe(
    "Use this on a shared computer. Changes that haven't been sent yet stay in this browser until you sign in again, so they aren't lost."
  );
  expect(fr.settings.menu.logoutRemoveLocalData).not.toBe('Supprimer aussi mes données de ce navigateur');
});

test('uses the same verbs in Account & App, and spells "Set up" as a verb', () => {
  expect(en.settings.accountPage.login.logoutLabel).toBe('Sign out');
  expect(en.settings.accountPage.login.description).toMatch(/^Sign out\b/);
  expect(en.settings.accountPage.login.title).not.toMatch(/log ?in|log ?out/i);
  expect(en.settings.accountPage.password.setupButton).toBe('Set up password');
  expect(fr.settings.accountPage.password.setupButton).toBeTruthy();
  expect(fr.settings.accountPage.login.description).toBeTruthy();
});
