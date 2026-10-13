import { fireEvent, render, screen } from '@testing-library/react';

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
