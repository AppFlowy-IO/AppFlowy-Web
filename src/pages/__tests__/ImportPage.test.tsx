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

function mountAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path='/import' element={<ImportPage />} />
        <Route path='/app' element={<AppLocation />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  Object.assign(mockCreation, { status: 'ready', canCreate: false });
});

test('a denied account can close the direct importer and continue to its workspaces', async () => {
  mountAt('/import?action=import&source=notion');

  const dialog = await screen.findByRole('dialog');

  expect(within(dialog).getByText('workspaceCreation.denied')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'button.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // The page itself gives the reason and leads to the app instead of reopening the same dead end.
  expect(screen.getByText('workspaceCreation.denied')).toBeTruthy();
  expect(screen.queryByText('workspaceCreation.importPageHint')).toBeNull();
  expect(screen.queryByRole('button', { name: 'workspaceCreation.importWorkspace' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'invitation.openWorkspace' }).at(-1)!);
  expect((await screen.findByTestId('app-location')).textContent).toBe('/app');
});

test.each(['loading', 'error'])(
  'while the answer is %s, the page keeps the importer, which explains itself',
  (status) => {
    Object.assign(mockCreation, { status, canCreate: false });
    mountAt('/import');
    expect(screen.queryByText('workspaceCreation.denied')).toBeNull();
    expect(screen.getByText('workspaceCreation.importPageHint')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'workspaceCreation.importWorkspace' })).toBeTruthy();
  }
);

test('the importer can be opened again from the page with the original source', async () => {
  mockCreation.canCreate = true;
  mountAt('/import?action=import&source=confluence');

  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'button.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'workspaceCreation.importWorkspace' }));
  const dialog = await screen.findByRole('dialog');

  expect(within(dialog).getByRole('tab', { name: 'web.importFromConfluence' }).getAttribute('aria-selected')).toBe('true');
});
