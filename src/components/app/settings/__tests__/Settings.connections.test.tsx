import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import * as IntegrationService from '@/application/services/domains/integration';

import { SettingsDialog } from '../Settings';

const mockTranslate = (key: string) => key;
let mockWorkspaceId = 'workspace-1';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceId: () => mockWorkspaceId }));
jest.mock('@/components/app/settings/AccountAppPanel', () => ({ AccountAppPanel: () => null }));
jest.mock('@/components/app/settings/ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('@/components/app/settings/MembersPanel', () => ({ MembersPanel: () => null }));
jest.mock('@/components/app/settings/ManageDataPanel', () => ({ ManageDataPanel: () => null }));
jest.mock('@/application/services/domains/integration', () => ({
  getConfiguredProviders: jest.fn(),
  listConnections: jest.fn(),
  getConnectionEmail: jest.fn(),
}));

const api = jest.mocked(IntegrationService);
const onClose = jest.fn();
const renderSettings = (open = true) => (
  <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
    <SettingsDialog open={open} onClose={onClose} />
  </MemoryRouter>
);

describe('Connections settings lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = 'workspace-1';
    api.listConnections.mockResolvedValue([]);
    api.getConfiguredProviders.mockResolvedValue(['google-drive', 'google-calendar']);
    api.getConnectionEmail.mockResolvedValue(undefined);
  });

  it('loads connections only when selected and aborts requests when settings closes', async () => {
    const { rerender } = render(renderSettings());

    expect(api.listConnections).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('settings-menu-connections'));
    await screen.findByTestId('connect-google-drive');
    expect(api.listConnections).toHaveBeenCalledWith('workspace-1', expect.any(AbortSignal));
    const signal = api.listConnections.mock.calls[0][1]!;

    rerender(renderSettings(false));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId('connections-panel')).toBeNull();
  });

  it('discards a late response from a previous workspace', async () => {
    let resolvePrevious!: (connections: Awaited<ReturnType<typeof IntegrationService.listConnections>>) => void;

    api.listConnections.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrevious = resolve;
        })
    );
    const { rerender } = render(renderSettings());

    fireEvent.click(screen.getByTestId('settings-menu-connections'));
    await waitFor(() => expect(api.listConnections).toHaveBeenCalledTimes(1));
    const previousSignal = api.listConnections.mock.calls[0][1]!;

    mockWorkspaceId = 'workspace-2';
    rerender(renderSettings());
    await screen.findByTestId('connect-google-drive');
    expect(previousSignal.aborted).toBe(true);
    expect(api.listConnections).toHaveBeenLastCalledWith('workspace-2', expect.any(AbortSignal));
    await act(async () =>
      resolvePrevious([
        {
          id: 'old-connection',
          provider: 'google-drive',
          connected_at: '2026-09-19',
          status: 'active',
          account_identifier: 'previous@example.com',
        },
      ])
    );
    expect(screen.queryByText('previous@example.com')).toBeNull();
    expect(api.getConnectionEmail).not.toHaveBeenCalled();
  });
});
