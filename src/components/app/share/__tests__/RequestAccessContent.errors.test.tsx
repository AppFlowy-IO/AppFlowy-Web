import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AccessService } from '@/application/services/domains';

import { RequestAccessContent } from '../RequestAccessContent';

const mockTranslate = (key: string, fallback?: string) => fallback || key;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/application/services/domains', () => ({ AccessService: { sendRequestAccess: jest.fn() } }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => undefined,
  useAppViewId: () => undefined,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const accessGuidance =
  'This access request is missing required page information. Please reopen the shared page and try again.';

beforeEach(() => {
  jest.clearAllMocks();
});

it.each([
  {},
  { workspaceId: 'workspace' },
  { viewId: 'view' },
])('explains how to recover from missing access request context: %j', async (props) => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RequestAccessContent {...props} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'landingPage.noAccess.requestAccess' }));

  expect(await screen.findByText(accessGuidance)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'landingPage.error.retry' }));
  expect(await screen.findByText(accessGuidance)).toBeTruthy();
  expect(AccessService.sendRequestAccess).not.toHaveBeenCalled();
});

it('does not use raw server diagnostics as the access request description', async () => {
  jest.mocked(AccessService.sendRequestAccess).mockRejectedValue({ message: 'SQLSTATE: private access diagnostic' });
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RequestAccessContent workspaceId='workspace' viewId='view' />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'landingPage.noAccess.requestAccess' }));

  expect(await screen.findByText('Something went wrong. Contact support if this keeps happening.')).toBeTruthy();
  expect(screen.queryByText(/SQLSTATE/)).toBeNull();
  expect(screen.queryByText(accessGuidance)).toBeNull();
  expect(AccessService.sendRequestAccess).toHaveBeenCalledWith('workspace', 'view');
});
