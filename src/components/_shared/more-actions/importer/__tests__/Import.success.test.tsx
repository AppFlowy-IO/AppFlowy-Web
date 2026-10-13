import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { FileService } from '@/application/services/domains';

import Import from '../Import';

const mockCreation = {
  status: 'ready',
  canCreate: true,
  checking: false,
  refresh: jest.fn(),
  isCurrent: () => true,
  scopeKey: 'server:user',
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/components/login', () => ({ LoginModal: () => null }));
jest.mock('@/application/services/domains', () => ({
  FileService: {
    CreateImportTaskType: { Workspace: 'Workspace', Notion: 'Notion', Confluence: 'Confluence' },
    importFile: jest.fn(),
  },
}));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({
  useWorkspaceCreationCapability: () => mockCreation,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => 'user',
  useIsAuthenticatedOptional: () => true,
}));

function Search() {
  const location = useLocation();

  return <output data-testid='search'>{location.search}</output>;
}

test('a host that wants to know about the upload still gives the user a confirmation', async () => {
  const onSuccessfulImport = jest.fn();

  jest.mocked(FileService.importFile).mockResolvedValue(undefined);
  render(
    <MemoryRouter initialEntries={['/app?action=import&source=appflowy']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Import onSuccessfulImport={onSuccessfulImport} successMessage='Your import is being processed.' />
      <Search />
    </MemoryRouter>
  );

  const input = (await screen.findByTestId('file-dropzone')).querySelector('input')!;

  fireEvent.change(input, { target: { files: [new File(['zip'], 'export.zip', { type: 'application/zip' })] } });
  await waitFor(() => expect(onSuccessfulImport).toHaveBeenCalledTimes(1));
  const confirmation = await screen.findByText('Your import is being processed.');

  expect(screen.getByText('web.importSuccess')).toBeTruthy();
  const dialog = confirmation.closest('[role="dialog"]') as HTMLElement;

  fireEvent.click(within(dialog).getByRole('button', { name: 'button.ok' }));
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
