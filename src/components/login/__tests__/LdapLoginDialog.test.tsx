import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import LdapLoginDialog from '../LdapLoginDialog';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('LdapLoginDialog', () => {
  it('has an accessible name and description', () => {
    const onSubmit = jest.fn<(username: string, password: string) => Promise<void>>().mockResolvedValue();

    render(<LdapLoginDialog open onOpenChange={jest.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole('dialog', { name: 'web.ldapLogin' });

    expect(dialog.getAttribute('aria-labelledby')).toBe('ldap-login-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('ldap-login-description');
    expect(document.getElementById('ldap-login-description')?.textContent).toBe('web.ldapLoginDescription');
  });

  it('cannot be dismissed while authentication is pending', async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn(() => new Promise<void>(() => undefined));

    render(<LdapLoginDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('web.ldapUsernamePlaceholder'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('web.ldapPasswordPlaceholder'), {
      target: { value: 'alice-secret-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'web.continue' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('alice', 'alice-secret-pw');
      expect(screen.queryByRole('button', { name: 'button.close' })).toBeNull();
    });

    const cancelButton = screen.getByRole('button', { name: 'button.cancel' });

    expect(cancelButton).toHaveProperty('disabled', true);
    fireEvent.keyDown(screen.getByTestId('ldap-login-dialog'), { key: 'Escape' });
    fireEvent.click(cancelButton);

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
