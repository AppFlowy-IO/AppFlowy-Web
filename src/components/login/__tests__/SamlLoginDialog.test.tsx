import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import SamlLoginDialog from '../SamlLoginDialog';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SamlLoginDialog', () => {
  it('has an accessible name and description', () => {
    const onSubmit = jest.fn<(domain: string) => Promise<void>>().mockResolvedValue();

    render(<SamlLoginDialog open onOpenChange={jest.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole('dialog', { name: 'web.ssoLogin' });

    expect(dialog.getAttribute('aria-labelledby')).toBe('saml-login-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('saml-login-description');
    expect(document.getElementById('saml-login-description')?.textContent).toBe('web.ssoLoginDescription');
  });
});
