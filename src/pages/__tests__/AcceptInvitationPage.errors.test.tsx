import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AccessService } from '@/application/services/domains';
import { handleAPIError } from '@/application/services/js-services/http/core';
import type LandingPage from '@/components/_shared/landing-page/LandingPage';

import AcceptInvitationPage from '../AcceptInvitationPage';

import type { ComponentProps } from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
  Trans: () => null,
}));
jest.mock('@/application/services/domains', () => ({
  AccessService: { getInvitation: jest.fn(), acceptInvitation: jest.fn() },
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ email: 'invitee@example.com' }) }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerHostingMode: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/_shared/landing-page/LandingPage', () => ({
  __esModule: true,
  default: ({ title, description, primaryAction }: ComponentProps<typeof LandingPage>) => (
    <main>{title}{description}{primaryAction && <button onClick={primaryAction.onClick}>{primaryAction.label}</button>}</main>
  ),
}));

it.each(['load', 'accept'])('retains public copy and support diagnostics when invitation %s fails', async (operation) => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  const failure = handleAPIError({
    code: 1017,
    message: 'SQLSTATE: private invitation diagnostic',
    sourceDomain: 'appflowy.server',
    requestId: 'invitation-123',
    user_error: { schema_version: 1, reason: 'INVITATION_PENDING', message: 'Ask the owner to renew this invitation.', locale: 'en' },
  });

  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  jest.mocked(AccessService.getInvitation).mockReset();
  if (operation === 'load') {
    jest.mocked(AccessService.getInvitation).mockRejectedValue(failure);
  } else {
    jest.mocked(AccessService.getInvitation).mockResolvedValue({
      invite_id: 'invitation-1', workspace_id: 'workspace-1', workspace_name: 'Test workspace',
      inviter_email: 'owner@example.com', inviter_name: 'Owner', inviter_icon: '',
      workspace_icon: '', member_count: 1, status: 'Pending',
    });
    jest.mocked(AccessService.acceptInvitation).mockRejectedValue(failure);
  }

  render(<MemoryRouter initialEntries={['/?invited_id=invitation-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AcceptInvitationPage />
  </MemoryRouter>);
  if (operation === 'accept') fireEvent.click(screen.getByRole('button', { name: 'landingPage.inviteMember.joinWorkspace' }));

  expect(await screen.findByText('Error 1017: Ask the owner to renew this invitation.')).toBeTruthy();
  expect(screen.queryByText(/SQLSTATE/)).toBeNull();
  fireEvent.click(screen.getByText('copy error'));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).toContain('SQLSTATE: private invitation diagnostic');
  expect(writeText.mock.calls[0][0]).toContain('Reference: invitation-123');
});
