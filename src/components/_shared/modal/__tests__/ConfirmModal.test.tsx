import { fireEvent, render, screen, within } from '@testing-library/react';

import { ConfirmModal } from '../ConfirmModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ConfirmModal', () => {
  it('uses the shared MUI dialog and destructive action', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    render(
      <ConfirmModal
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title='Delete'
        description='This action cannot be undone.'
        dialogTestId='confirm-modal'
        confirmTestId='confirm-action'
      />
    );

    const modal = screen.getByTestId('confirm-modal');
    const dialog = within(modal).getByRole('dialog', { name: 'Delete' });
    const description = within(dialog).getByText('This action cannot be undone.');

    expect(modal.className).toContain('MuiDialog-root');
    expect(within(dialog).getByText('Delete')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBe(description.id);

    fireEvent.click(within(dialog).getByRole('button', { name: 'button.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('confirm-action'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
