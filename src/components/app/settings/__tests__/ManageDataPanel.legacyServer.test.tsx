import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { clearWorkspaceCreationCapabilityCache } from '@/components/app/hooks/useWorkspaceCreationCapability';

import { ManageDataPanel } from '../ManageDataPanel';

// Only the transport is replaced: the real capability hook and client decide what the panel shows.
const mockClient = { get: jest.fn() };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({ ExportService: { exportWorkspace: jest.fn() } }));
jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: 'user' } }) }));
jest.mock('@/application/services/js-services/http/core', () => ({
  getAxios: () => mockClient,
  executeAPIRequest: async (request: () => Promise<{ data: unknown }>) => (await request()).data,
}));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'current-workspace',
  useUserWorkspaceInfo: () => ({ workspaces: [{ id: 'current-workspace', owner: { uid: 42 } }] }),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: '43' }),
  useAuthenticatedUserIdOptional: () => 'user',
  useIsAuthenticatedOptional: () => true,
}));

beforeEach(() => {
  clearWorkspaceCreationCapabilityCache();
  mockClient.get.mockReset();
});

test.each([404, 405])(
  'a server without the capability route (%s) keeps new-workspace import open and lets the server decide',
  async (status) => {
    const onImport = jest.fn();

    mockClient.get.mockRejectedValue({ code: status, httpStatus: status, message: 'Not Found' });
    render(<ManageDataPanel onImport={onImport} />);
    const importButton = screen.getByTestId('manage-data-import');

    await waitFor(() => expect(importButton.disabled).toBe(false));
    expect(mockClient.get).toHaveBeenCalledWith('/api/user/workspace-creation-capability');
    expect(screen.getByText('workspaceCreation.ownership')).toBeTruthy();
    fireEvent.click(importButton);
    expect(onImport).toHaveBeenCalledTimes(1);
  }
);

test('an application error sent with HTTP 404 is not mistaken for an older server', async () => {
  mockClient.get.mockRejectedValue({ code: -2, httpStatus: 404, message: 'missing' });
  render(<ManageDataPanel onImport={jest.fn()} />);

  expect(await screen.findByText('workspaceCreation.unavailable')).toBeTruthy();
  expect(screen.getByTestId('manage-data-import').disabled).toBe(true);
});
