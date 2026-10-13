import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import ImportPage from '../ImportPage';

const mockCreation = {
  status: 'ready',
  canCreate: false,
  checking: false,
  legacy: false,
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

function AppLocation() {
  const location = useLocation();

  return <output data-testid='app-location'>{location.pathname}</output>;
}

test('a denied account can close the direct importer and continue to its workspaces', async () => {
  render(
    <MemoryRouter
      initialEntries={['/import?action=import&source=notion']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Routes>
        <Route path='/import' element={<ImportPage />} />
        <Route path='/app' element={<AppLocation />} />
      </Routes>
    </MemoryRouter>
  );

  const dialog = await screen.findByRole('dialog');

  expect(within(dialog).getByText('workspaceCreation.denied')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'button.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // The page itself explains the choice and leads to the app instead of a blank screen.
  expect(screen.getByText('workspaceCreation.importPageHint')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'invitation.openWorkspace' }).at(-1)!);
  expect((await screen.findByTestId('app-location')).textContent).toBe('/app');
});

test('the importer can be opened again from the page with the original source', async () => {
  mockCreation.canCreate = true;
  render(
    <MemoryRouter
      initialEntries={['/import?action=import&source=confluence']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Routes>
        <Route path='/import' element={<ImportPage />} />
      </Routes>
    </MemoryRouter>
  );

  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'button.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.importWorkspace' }));
  const dialog = await screen.findByRole('dialog');

  expect(within(dialog).getByRole('tab', { name: 'web.importFromConfluence' }).getAttribute('aria-selected')).toBe('true');
});
