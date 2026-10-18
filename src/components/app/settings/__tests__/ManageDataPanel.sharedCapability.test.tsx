import { render, screen, waitFor } from '@testing-library/react';

import {
  clearWorkspaceCreationCapabilityCache,
  useWorkspaceCreationCapability,
} from '@/components/app/hooks/useWorkspaceCreationCapability';

import { ManageDataPanel } from '../ManageDataPanel';

const mockRead = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({ ExportService: { exportWorkspace: jest.fn() } }));
jest.mock('@/application/services/js-services/http/workspace-creation-api', () => ({
  getWorkspaceCreationCapability: () => mockRead(),
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

// The sidebar's workspace switcher: always mounted, so it has read the answer before Settings opens.
function Switcher() {
  return <span data-testid='switcher'>{useWorkspaceCreationCapability().status}</span>;
}

beforeEach(() => {
  clearWorkspaceCreationCapabilityCache();
  mockRead.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

test('Manage data opens with the answer the sidebar already has, without checking again', async () => {
  mockRead.mockResolvedValue({ supported: true, mode: 'selected_users', revision: '1', can_create_workspace: true });
  render(<Switcher />);
  await waitFor(() => expect(screen.getByTestId('switcher').textContent).toBe('ready'));
  render(<ManageDataPanel onImport={jest.fn()} />);

  expect(screen.getByTestId('manage-data-import').disabled).toBe(false);
  expect(screen.queryByText('workspaceCreation.loading')).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
});
