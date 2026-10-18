import { fireEvent, render, screen } from '@testing-library/react';

import { ManageDataPanel } from '../ManageDataPanel';

const mockCreation = {
  status: 'ready',
  canCreate: true,
  checking: false,
  refresh: jest.fn(),
  isCurrent: () => true,
  scopeKey: 'server:user',
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({ ExportService: { exportWorkspace: jest.fn() } }));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({
  useWorkspaceCreationCapability: () => mockCreation,
}));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'current-workspace',
  useUserWorkspaceInfo: () => ({ workspaces: [{ id: 'current-workspace', owner: { uid: 42 } }] }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => ({ uid: '43' }) }));

function setCreation(status: 'loading' | 'ready' | 'error', canCreate: boolean) {
  Object.assign(mockCreation, { status, canCreate });
}

beforeEach(() => {
  jest.clearAllMocks();
  setCreation('ready', true);
});

test.each([
  ['a denial', 'ready', 'workspaceCreation.denied'],
  ['still loading', 'loading', 'workspaceCreation.loading'],
  ['unreadable', 'error', 'workspaceCreation.unavailable'],
] as const)('new-workspace import stays closed and says why when the answer is %s', (_label, status, reason) => {
  const onImport = jest.fn();

  setCreation(status, false);
  render(<ManageDataPanel onImport={onImport} />);
  const importButton = screen.getByTestId('manage-data-import');

  expect(importButton.disabled).toBe(true);
  fireEvent.click(importButton);
  expect(onImport).not.toHaveBeenCalled();
  expect(screen.getByText(reason)).toBeTruthy();
  expect(screen.queryByText('workspaceCreation.ownership')).toBeNull();
});

test('an unreadable answer offers Check again; a denial does not', () => {
  setCreation('error', false);
  const { rerender } = render(<ManageDataPanel onImport={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.checkAgain' }));
  expect(mockCreation.refresh).toHaveBeenCalledTimes(1);
  setCreation('ready', false);
  rerender(<ManageDataPanel onImport={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'workspaceCreation.checkAgain' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'button.retry' })).toBeNull();
});

// A server without the capability route is covered end to end in ManageDataPanel.legacyServer.test.
test('an allowed account can open the importer and is told it will own the result', () => {
  const onImport = jest.fn();

  setCreation('ready', true);
  render(<ManageDataPanel onImport={onImport} />);
  fireEvent.click(screen.getByTestId('manage-data-import'));
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(screen.getByText('workspaceCreation.ownership')).toBeTruthy();
});
