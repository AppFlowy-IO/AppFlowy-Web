import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import translations from '@/@types/translations/en.json';
import { INTEGRATION_OAUTH_CALLBACK } from '@/application/integrations/oauth';
import { IntegrationConnection } from '@/application/integrations/types';
import * as IntegrationService from '@/application/services/domains/integration';

import { ConnectionsPanel } from '../ConnectionsPanel';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslator }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/application/services/domains/integration', () => ({
  getConfiguredProviders: jest.fn(),
  listConnections: jest.fn(),
  connectProvider: jest.fn(),
  confirmConnection: jest.fn(),
  disconnectConnection: jest.fn(),
  getConnectionEmail: jest.fn(),
}));

const mockTranslate = (key: string, params?: Record<string, string>) => {
  let text =
    (key
      .split('.')
      .reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], translations) as string) || key;

  for (const [name, value] of Object.entries(params || {})) text = text.replace(`{{${name}}}`, value);
  return text;
};

let mockTranslator = mockTranslate;
const api = jest.mocked(IntegrationService);
const drive: IntegrationConnection = {
  id: 'drive-1',
  provider: 'google-drive',
  connected_at: '2026-09-19T00:00:00Z',
  status: 'active',
  account_identifier: 'stored@example.com',
};
const calendar: IntegrationConnection = {
  ...drive,
  id: 'calendar-1',
  provider: 'google-calendar',
  account_identifier: 'calendar@example.com',
};

function openMenu(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
}

describe('Connections settings', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTranslator = mockTranslate;
    api.listConnections.mockResolvedValue([]);
    api.getConfiguredProviders.mockResolvedValue(['google-drive', 'google-calendar']);
    api.getConnectionEmail.mockResolvedValue(undefined);
    api.disconnectConnection.mockResolvedValue({ success: true });
    api.confirmConnection.mockResolvedValue({ success: true, connection: drive });
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists both providers and allows adding accounts from the menu', async () => {
    render(<ConnectionsPanel workspaceId='workspace' />);
    expect(await screen.findByTestId('connect-google-drive')).toBeTruthy();
    expect(screen.getByTestId('connect-google-calendar')).toBeTruthy();
    expect(api.listConnections).toHaveBeenCalledWith('workspace', expect.any(AbortSignal));
    openMenu(screen.getByRole('button', { name: 'Add connection' }));
    expect(await screen.findByRole('menuitem', { name: 'Google Drive' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Google Calendar' })).toBeTruthy();
  });

  it('does not open a popup for unconfigured providers and refreshes after server setup', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    api.getConfiguredProviders.mockResolvedValueOnce([]).mockResolvedValueOnce(['google-drive']);
    render(<ConnectionsPanel workspaceId='workspace' />);
    const driveButton = await screen.findByTestId('connect-google-drive');

    expect(driveButton.disabled).toBe(true);
    expect(screen.getByTestId('connect-google-calendar').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add connection' }).disabled).toBe(true);
    expect(
      screen.getByText('Unavailable connections: Google Drive, Google Calendar. Ask your administrator to enable them.')
    ).toBeTruthy();
    fireEvent.click(driveButton);
    expect(open).not.toHaveBeenCalled();
    expect(api.connectProvider).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('connect-google-drive').disabled).toBe(false));
    expect(screen.getByTestId('connect-google-calendar').disabled).toBe(true);
    openMenu(screen.getByRole('button', { name: 'Add connection' }));
    expect((await screen.findByRole('menuitem', { name: 'Google Calendar' })).getAttribute('aria-disabled')).toBe(
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Google Drive' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows setup guidance when a provider becomes unavailable after the panel loads', async () => {
    const popup = { close: jest.fn() } as unknown as Window;

    jest.spyOn(window, 'open').mockReturnValue(popup);
    api.connectProvider.mockRejectedValue({
      code: 1008,
      message: 'Invalid request:provider google-drive is not configured',
    });
    render(<ConnectionsPanel workspaceId='workspace' />);
    fireEvent.click(await screen.findByTestId('connect-google-drive'));
    expect(
      await screen.findByText('Unavailable connections: Google Drive. Ask your administrator to enable them.')
    ).toBeTruthy();
    expect(popup.close).toHaveBeenCalled();
    expect(screen.getByTestId('connect-google-drive').disabled).toBe(true);
    expect(screen.getByTestId('connect-google-calendar').disabled).toBe(false);
    expect(api.confirmConnection).not.toHaveBeenCalled();
  });

  it('keeps connection errors visible in the panel and clears them on the next attempt', async () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    render(<ConnectionsPanel workspaceId='workspace' />);
    fireEvent.click(await screen.findByTestId('connect-google-drive'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Allow pop-ups for AppFlowy, then try connecting again.'
    );

    const popup = { close: jest.fn() } as unknown as Window;

    open.mockReturnValue(popup);
    api.connectProvider.mockRejectedValue(new Error('Network unavailable'));
    fireEvent.click(screen.getByTestId('connect-google-drive'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Network unavailable'));
    expect(popup.close).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('allows disconnecting an existing account when its provider is no longer configured', async () => {
    api.getConfiguredProviders.mockResolvedValue([]);
    api.listConnections.mockResolvedValue([drive]);
    render(<ConnectionsPanel workspaceId='workspace' />);
    await screen.findByText('stored@example.com');
    openMenu(within(screen.getByTestId('connection-drive-1')).getByRole('button'));
    expect(
      (await screen.findByRole('menuitem', { name: 'Connect another account' })).getAttribute('aria-disabled')
    ).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect account' }));
    fireEvent.click(await screen.findByTestId('confirm-disconnect-connection'));
    await waitFor(() => expect(screen.queryByTestId('connection-drive-1')).toBeNull());
    expect(api.disconnectConnection).toHaveBeenCalledWith('drive-1', expect.any(AbortSignal));
  });

  it('keeps Connect disabled until provider availability can be loaded', async () => {
    api.getConfiguredProviders
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce(['google-drive']);
    render(<ConnectionsPanel workspaceId='workspace' />);
    expect((await screen.findByRole('alert')).textContent).toContain('Server unavailable');
    expect(screen.getByRole('button', { name: 'Add connection' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByTestId('connect-google-drive')).disabled).toBe(false);
  });

  it('confirms authorization once, refreshes accounts, and shows provider email', async () => {
    const popup = {
      closed: false,
      close: jest.fn(),
      postMessage: jest.fn(),
      location: { href: '' },
    } as unknown as Window;

    jest.spyOn(window, 'open').mockReturnValue(popup);
    api.connectProvider.mockResolvedValue({
      connection_id: 'new-connection',
      oauth_url:
        'https://accounts.google.com/auth?state=expected-state&redirect_uri=https%3A%2F%2Fcloud.example.com%2Fcallback',
    });
    api.listConnections.mockResolvedValueOnce([]).mockResolvedValue([drive]);
    api.getConnectionEmail.mockResolvedValue('actual@example.com');
    render(<ConnectionsPanel workspaceId='workspace' />);
    fireEvent.click(await screen.findByTestId('connect-google-drive'));
    expect(screen.getByText('Complete authorization in the browser window.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add connection' }).disabled).toBe(true);
    await waitFor(() => expect(popup.location.href).toContain('expected-state'));

    await act(async () => {
      const event = () =>
        new MessageEvent('message', {
          origin: 'https://cloud.example.com',
          source: popup,
          data: { type: INTEGRATION_OAUTH_CALLBACK, oauth_query: 'code=code&state=expected-state' },
        });

      window.dispatchEvent(event());
      window.dispatchEvent(event());
    });
    expect(await screen.findByText('actual@example.com')).toBeTruthy();
    expect(api.confirmConnection).toHaveBeenCalledTimes(1);
    expect(api.confirmConnection).toHaveBeenCalledWith(
      'workspace',
      'google-drive',
      'new-connection',
      'code=code&state=expected-state',
      expect.any(AbortSignal)
    );
    expect(api.listConnections).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Complete authorization in the browser window.')).toBeNull();
  });

  it('keeps a failed load distinct from an empty list and supports retry', async () => {
    api.listConnections.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce([]);
    render(<ConnectionsPanel workspaceId='workspace' />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('connect-google-drive')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('connect-google-drive')).toBeTruthy();
  });

  it('does not refetch connections when the translation function changes', async () => {
    api.listConnections.mockResolvedValue([drive]);
    const { rerender } = render(<ConnectionsPanel workspaceId='workspace' />);

    await screen.findByText('stored@example.com');
    mockTranslator = (key, params) => mockTranslate(key, params);
    rerender(<ConnectionsPanel workspaceId='workspace' />);
    expect(api.listConnections).toHaveBeenCalledTimes(1);
    expect(api.getConfiguredProviders).toHaveBeenCalledTimes(1);
    expect(api.getConnectionEmail).toHaveBeenCalledTimes(1);
  });

  it('fetches only the new account email when OAuth refreshes unchanged connection objects', async () => {
    const popup = {
      closed: false,
      close: jest.fn(),
      postMessage: jest.fn(),
      location: { href: '' },
    } as unknown as Window;

    jest.spyOn(window, 'open').mockReturnValue(popup);
    api.connectProvider.mockResolvedValue({
      connection_id: 'calendar-1',
      oauth_url: 'https://accounts.google.com/auth?state=state&redirect_uri=https%3A%2F%2Fcloud.example.com%2Fcallback',
    });
    api.listConnections.mockResolvedValueOnce([drive]).mockResolvedValueOnce([{ ...drive }, calendar]);
    render(<ConnectionsPanel workspaceId='workspace' />);
    await screen.findByText('stored@example.com');
    openMenu(screen.getByRole('button', { name: 'Add connection' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Google Calendar' }));
    await waitFor(() => expect(popup.location.href).toContain('state=state'));
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://cloud.example.com',
          source: popup,
          data: { type: INTEGRATION_OAUTH_CALLBACK, oauth_query: 'code=code&state=state' },
        })
      )
    );
    await screen.findByText('calendar@example.com');
    expect(api.getConnectionEmail).toHaveBeenCalledTimes(2);
    expect(api.getConnectionEmail.mock.calls.map(([, connection]) => connection.id)).toEqual(['drive-1', 'calendar-1']);
  });

  it('preserves accounts on disconnect failure and removes only the confirmed account on success', async () => {
    api.listConnections.mockResolvedValue([drive, calendar, { ...drive, id: 'unknown', provider: 'unknown-provider' }]);
    api.getConnectionEmail.mockRejectedValue(new Error('Provider offline'));
    api.disconnectConnection.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true });
    render(<ConnectionsPanel workspaceId='workspace' />);
    expect(await screen.findByText('stored@example.com')).toBeTruthy();
    expect(screen.getByText('calendar@example.com')).toBeTruthy();
    expect(screen.queryByTestId('connection-unknown')).toBeNull();
    openMenu(within(screen.getByTestId('connection-drive-1')).getByRole('button'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect account' }));
    expect(api.disconnectConnection).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('confirm-disconnect-connection'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Unable to disconnect this account. Please try again.')
    );
    expect(screen.getByTestId('connection-drive-1')).toBeTruthy();
    expect(screen.getByTestId('disconnect-connection-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-disconnect-connection'));
    await waitFor(() => expect(screen.queryByTestId('connection-drive-1')).toBeNull());
    expect(api.disconnectConnection).toHaveBeenLastCalledWith('drive-1', expect.any(AbortSignal));
    expect(screen.getByTestId('connection-calendar-1')).toBeTruthy();
  });

  it('cancels authorization when the panel unmounts without confirming a late response', async () => {
    const popup = {
      closed: false,
      close: jest.fn(),
      postMessage: jest.fn(),
      location: { href: '' },
    } as unknown as Window;

    jest.spyOn(window, 'open').mockReturnValue(popup);
    api.connectProvider.mockResolvedValue({
      connection_id: 'connection',
      oauth_url: 'https://accounts.google.com/auth?state=state&redirect_uri=https%3A%2F%2Fcloud.example.com%2Fcallback',
    });
    const { unmount } = render(<ConnectionsPanel workspaceId='workspace' />);

    fireEvent.click(await screen.findByTestId('connect-google-calendar'));
    await waitFor(() => expect(popup.location.href).toContain('state=state'));
    unmount();
    expect(popup.close).toHaveBeenCalled();
    expect(api.confirmConnection).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
