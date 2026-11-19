import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getDriveFile } from '@/application/integrations/google-drive';
import { openGoogleDrivePicker } from '@/application/integrations/google-drive-picker';
import { useConnections } from '@/components/app/settings/connections/useConnections';

import { GoogleDriveBrowser } from '../GoogleDriveBrowser';

jest.mock('react-i18next', () => {
  const t = (key: string) => key;

  return { useTranslation: () => ({ t }) };
});

jest.mock('@/components/app/settings/connections/useConnections', () => ({ useConnections: jest.fn() }));
jest.mock('@/application/integrations/google-drive', () => ({ getDriveFile: jest.fn() }));
jest.mock('@/application/integrations/google-drive-picker', () => ({ openGoogleDrivePicker: jest.fn() }));
jest.mock('@/application/services/domains/integration', () => ({ getConnectionEmail: jest.fn() }));
const api = jest.mocked({ useConnections, getDriveFile, openGoogleDrivePicker });
const personal = {
  id: 'personal',
  provider: 'google-drive' as const,
  status: 'active',
  connected_at: '',
  account_identifier: 'personal@example.com',
};
const work = { ...personal, id: 'work', account_identifier: 'work@example.com' };
let connections: ReturnType<typeof useConnections>;

beforeEach(() => {
  connections = {
    connections: [],
    configuredProviders: ['google-drive'],
    loading: false,
    pending: undefined,
    loadError: '',
    connectionError: '',
    connect: jest.fn(),
    cancel: jest.fn(),
    reload: jest.fn(),
  } as unknown as ReturnType<typeof useConnections>;
  api.useConnections.mockImplementation(() => connections);
  api.openGoogleDrivePicker.mockResolvedValue();
  api.getDriveFile.mockResolvedValue({ id: 'file', name: 'Roadmap', mimeType: 'document' });
});
afterEach(() => jest.clearAllMocks());

it('explains an unavailable server provider and allows refreshing after it is enabled', () => {
  connections = { ...connections, configuredProviders: [] };
  const view = render(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);
  const connect = screen.getByRole('button', {
    name: 'document.plugins.googleDrive.connectGoogleAccount',
  });

  expect(connect.disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('settings.connections.providersUnavailable');
  fireEvent.click(connect);
  expect(connections.connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'settings.connections.refresh' }));
  expect(connections.reload).toHaveBeenCalledTimes(1);

  connections = { ...connections, configuredProviders: ['google-drive'] };
  view.rerender(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);
  expect(screen.queryByText('settings.connections.providersUnavailable')).toBeNull();
  expect(connect.disabled).toBe(false);
  fireEvent.click(connect);
  expect(connections.connect).toHaveBeenCalledWith('google-drive');
});

// Ports the desktop BLoC cases: connect, cache account refresh, open the account
// picker after OAuth, and prefer the selected account. Network lifecycle stays
// exercised with the production useConnections in the integration browser suite.
it('connects without opening a file picker during an ordinary account refresh', () => {
  const view = render(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.googleDrive.connectGoogleAccount' }));
  expect(connections.connect).toHaveBeenCalledWith('google-drive');
  view.unmount();
  connections = { ...connections, connections: [personal, work] };
  render(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'document.plugins.googleDrive.chooseFrom work@example.com' })).toBeTruthy();
  expect(screen.queryByTestId('google-drive-native-picker')).toBeNull();
  expect(api.openGoogleDrivePicker).not.toHaveBeenCalled();
});
it('opens the newly connected account after the pending OAuth refresh finishes', async () => {
  const view = render(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.googleDrive.connectGoogleAccount' }));
  connections = { ...connections, pending: { stage: 'authorizing' } as ReturnType<typeof useConnections>['pending'] };
  view.rerender(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);
  connections = { ...connections, pending: undefined, connections: [work] };
  view.rerender(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);
  await waitFor(() =>
    expect(api.openGoogleDrivePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace',
        connectionId: 'work',
        signal: expect.any(AbortSignal),
      })
    )
  );
});
it('selects the requested account, preserves metadata and closes the picker', async () => {
  connections = { ...connections, connections: [personal, work] };
  const select = jest.fn();

  render(<GoogleDriveBrowser workspaceId='workspace' onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.googleDrive.chooseFrom work@example.com' }));
  await waitFor(() => expect(api.openGoogleDrivePicker).toHaveBeenCalledTimes(1));
  const session = api.openGoogleDrivePicker.mock.calls[0][0];

  await act(async () => session.onSelect({ id: 'file', name: 'Roadmap', mimeType: 'document' }));
  expect(api.getDriveFile).toHaveBeenCalledWith('workspace', 'work', 'file', session.signal);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'file' }), 'work@example.com');
  expect(session.signal.aborted).toBe(true);
  expect(screen.queryByTestId('google-drive-native-picker')).toBeNull();
});

it('cancel returns focus to the chosen account without selecting a file', async () => {
  connections = { ...connections, connections: [work] };
  const select = jest.fn();

  render(<GoogleDriveBrowser workspaceId='workspace' onSelect={select} />);
  const button = screen.getByRole('button', { name: 'document.plugins.googleDrive.chooseFrom work@example.com' });

  fireEvent.click(button);
  await waitFor(() => expect(api.openGoogleDrivePicker).toHaveBeenCalledTimes(1));
  await act(async () => api.openGoogleDrivePicker.mock.calls[0][0].onCancel());
  expect(document.activeElement).toBe(button);
  expect(select).not.toHaveBeenCalled();
});

it('aborts on workspace change and ignores late metadata after unmount', async () => {
  connections = { ...connections, connections: [work] };
  const select = jest.fn();
  const view = render(<GoogleDriveBrowser workspaceId='first' onSelect={select} />);

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.googleDrive.chooseFrom work@example.com' }));
  await waitFor(() => expect(api.openGoogleDrivePicker).toHaveBeenCalledTimes(1));
  const old = api.openGoogleDrivePicker.mock.calls[0][0];

  view.rerender(<GoogleDriveBrowser workspaceId='second' onSelect={select} />);
  expect(old.signal.aborted).toBe(true);
  let resolve!: (file: { id: string; name: string; mimeType: string }) => void;

  api.getDriveFile.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  await act(async () => api.openGoogleDrivePicker.mock.calls[1][0].onSelect({ id: 'file', name: 'Roadmap', mimeType: 'document' }));
  view.unmount();
  await act(async () => resolve({ id: 'file', name: 'Roadmap', mimeType: 'document' }));
  expect(select).not.toHaveBeenCalled();
});

it('keeps one picker across rerenders and permits retry after SDK/token failure', async () => {
  connections = { ...connections, connections: [work] };
  api.openGoogleDrivePicker.mockRejectedValueOnce(new Error('test failure'));
  const view = render(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.googleDrive.chooseFrom work@example.com' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'settings.connections.retry' }));
  await waitFor(() => expect(api.openGoogleDrivePicker).toHaveBeenCalledTimes(2));
  view.rerender(<GoogleDriveBrowser workspaceId='workspace' onSelect={jest.fn()} />);
  expect(api.openGoogleDrivePicker).toHaveBeenCalledTimes(2);
});
