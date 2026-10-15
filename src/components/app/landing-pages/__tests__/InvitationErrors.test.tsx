import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { WorkspaceService } from '@/application/services/domains';
import type LandingPage from '@/components/_shared/landing-page/LandingPage';

import { ApproveConversion } from '../ApproveConversion';
import { AsGuest } from '../AsGuest';

import type { ComponentProps } from 'react';

const mockTranslate = (key: string, fallback?: string) => fallback || key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
  Trans: () => null,
}));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getGuestInvitation: jest.fn(),
    acceptGuestInvitation: jest.fn(),
    getGuestToMemberConversionInfo: jest.fn(),
    approveTurnGuestToMember: jest.fn(),
  },
}));
jest.mock('@/components/main/app.hooks', () => ({ useIsAuthenticatedOptional: () => true }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerHostingMode: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/_shared/landing-page/LandingPage', () => ({
  __esModule: true,
  default: ({ title, description, primaryAction }: ComponentProps<typeof LandingPage>) => (
    <main>
      <h1>{title}</h1>
      {description}
      {primaryAction && <button onClick={primaryAction.onClick}>{primaryAction.label}</button>}
    </main>
  ),
}));

const invitationGuidance =
  'This invitation link is missing required information. Please ask the sender for a new link.';

describe.each([
  ['guest invitation', AsGuest, WorkspaceService.getGuestInvitation],
  ['guest conversion', ApproveConversion, WorkspaceService.getGuestToMemberConversionInfo],
] as const)('%s error guidance', (_name, Page, loadInvitation) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['', '?code=invitation', '?workspace_id=workspace'])('explains how to recover from missing URL fields: %s', async (query) => {
    render(
      <MemoryRouter
        initialEntries={[`/invitation${query}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Page />
      </MemoryRouter>
    );

    expect(await screen.findByText(invitationGuidance)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'landingPage.error.retry' }));
    expect(await screen.findByText(invitationGuidance)).toBeTruthy();
    expect(loadInvitation).not.toHaveBeenCalled();
    expect(WorkspaceService.acceptGuestInvitation).not.toHaveBeenCalled();
    expect(WorkspaceService.approveTurnGuestToMember).not.toHaveBeenCalled();
  });

  it('keeps raw server diagnostics out of the rendered guidance', async () => {
    jest.mocked(loadInvitation).mockRejectedValue({ message: 'SQLSTATE: private invitation diagnostic' });
    render(
      <MemoryRouter
        initialEntries={['/invitation?workspace_id=workspace&code=invitation']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Page />
      </MemoryRouter>
    );

    expect(await screen.findByText('Something went wrong. Contact support if this keeps happening.')).toBeTruthy();
    expect(screen.queryByText(/SQLSTATE/)).toBeNull();
    expect(screen.queryByText(invitationGuidance)).toBeNull();
    expect(loadInvitation).toHaveBeenCalledWith('workspace', 'invitation');
  });
});
