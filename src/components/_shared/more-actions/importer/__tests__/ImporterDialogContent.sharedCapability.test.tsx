import { render, screen, waitFor } from '@testing-library/react';

import {
  clearWorkspaceCreationCapabilityCache,
  useWorkspaceCreationCapability,
} from '@/components/app/hooks/useWorkspaceCreationCapability';

import ImporterDialogContent from '../ImporterDialogContent';

const mockRead = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  FileService: {
    CreateImportTaskType: { Notion: 'Notion', Workspace: 'Workspace', Confluence: 'Confluence' },
    importFile: jest.fn(),
  },
}));
jest.mock('@/application/services/js-services/http/workspace-creation-api', () => ({
  getWorkspaceCreationCapability: () => mockRead(),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => 'user',
  useIsAuthenticatedOptional: () => true,
}));

// The host that opens the importer (the sidebar switcher, /import) has read the answer already.
function Host() {
  return <span data-testid='host'>{useWorkspaceCreationCapability().status}</span>;
}

beforeEach(() => {
  clearWorkspaceCreationCapabilityCache();
  mockRead.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

test('the importer opens ready to take a file, without checking again', async () => {
  mockRead.mockResolvedValue({ supported: true, mode: 'selected_users', revision: '1', can_create_workspace: true });
  render(<Host />);
  await waitFor(() => expect(screen.getByTestId('host').textContent).toBe('ready'));
  render(<ImporterDialogContent onSuccess={jest.fn()} />);

  expect(screen.getByTestId('file-dropzone').querySelector('input')?.disabled).toBe(false);
  expect(screen.queryByText('workspaceCreation.loading')).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
});
