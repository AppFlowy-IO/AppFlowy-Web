import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { FileService } from '@/application/services/domains';
import Import from '@/components/_shared/more-actions/importer/Import';
import { SettingsDialog } from '@/components/app/settings/Settings';

const mockImportFile = jest.fn();
const mockExportWorkspace = jest.fn();
const mockSettingsClose = jest.fn();
const mockImportSuccess = jest.fn();
const mockTranslate = (key: string) => key;
let mockCurrentUserUid = '42';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

jest.mock('@/application/services/domains', () => ({
  FileService: {
    CreateImportTaskType: { Workspace: 'Workspace', Notion: 'Notion', Confluence: 'Confluence' },
    importFile: (...args: unknown[]) => mockImportFile(...args),
  },
  ExportService: {
    exportWorkspace: (...args: unknown[]) => mockExportWorkspace(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'current-workspace',
  useUserWorkspaceInfo: () => ({
    workspaces: [{ id: 'current-workspace', owner: { uid: 42 } }],
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: mockCurrentUserUid }),
  useIsAuthenticatedOptional: () => true,
}));

jest.mock('@/components/app/settings/AccountAppPanel', () => ({ AccountAppPanel: () => null }));
jest.mock('@/components/app/settings/MembersPanel', () => ({ MembersPanel: () => null }));
jest.mock('@/components/app/settings/ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('@/components/login', () => ({ LoginModal: () => null }));

function SettingsWithWorkspaceImport() {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const location = useLocation();

  return (
    <>
      <output data-testid='current-route'>{location.pathname + location.search}</output>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          mockSettingsClose();
          setSettingsOpen(false);
        }}
      />
      <Import onSuccessfulImport={mockImportSuccess} />
    </>
  );
}

function renderManageData() {
  render(
    <MemoryRouter
      initialEntries={['/app/current-workspace/current-page?keep=first&keep=second&source=old-source']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <SettingsWithWorkspaceImport />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByTestId('settings-menu-manage_data'));
}

describe('Settings workspace import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUserUid = '42';
    mockImportFile.mockResolvedValue(undefined);
    mockExportWorkspace.mockResolvedValue(undefined);
  });

  it('opens the shared workspace importer and submits Confluence only after choosing its ZIP', async () => {
    renderManageData();

    fireEvent.click(screen.getByTestId('manage-data-import'));

    const confluenceTab = await screen.findByRole('tab', { name: 'web.importFromConfluence' });

    await waitFor(() => expect(screen.queryByTestId('settings-dialog')).toBeNull());
    expect(mockSettingsClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'web.importFromAppFlowy' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'web.importFromNotion' })).toBeTruthy();
    expect(screen.getByText('web.importCreatesWorkspace')).toBeTruthy();

    const route = new URL(screen.getByTestId('current-route').textContent!, 'http://localhost');

    expect(route.pathname).toBe('/app/current-workspace/current-page');
    expect(route.searchParams.get('action')).toBe('import');
    expect(route.searchParams.get('source')).toBe('appflowy');
    expect(route.searchParams.getAll('keep')).toEqual(['first', 'second']);
    expect(mockImportFile).not.toHaveBeenCalled();

    fireEvent.click(confluenceTab);
    expect(confluenceTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('web.dropConfluenceFile')).toBeTruthy();
    expect(mockImportFile).not.toHaveBeenCalled();

    const input = screen.getByTestId('file-dropzone').querySelector('input')!;
    const file = new File(['confluence-html-export'], 'space.html.zip', { type: 'application/zip' });

    expect(input.multiple).toBe(false);
    expect(input.accept).toContain('.zip');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockImportSuccess).toHaveBeenCalledTimes(1));
    expect(mockImportFile).toHaveBeenCalledTimes(1);
    expect(mockImportFile).toHaveBeenCalledWith(file, {
      taskType: FileService.CreateImportTaskType.Confluence,
      onProgress: expect.any(Function),
    });
    expect(mockExportWorkspace).not.toHaveBeenCalled();
  });

  it('keeps backup available to the workspace owner', async () => {
    renderManageData();

    fireEvent.click(screen.getByTestId('manage-data-backup'));

    await waitFor(() => expect(mockExportWorkspace).toHaveBeenCalledWith('current-workspace'));
    expect(mockImportFile).not.toHaveBeenCalled();
    expect(mockSettingsClose).not.toHaveBeenCalled();
  });

  it('allows a member to open workspace import while hiding owner-only backup', async () => {
    mockCurrentUserUid = '43';
    renderManageData();

    expect(screen.queryByTestId('manage-data-backup')).toBeNull();
    fireEvent.click(screen.getByTestId('manage-data-import'));

    expect(await screen.findByRole('tab', { name: 'web.importFromConfluence' })).toBeTruthy();
    expect(mockExportWorkspace).not.toHaveBeenCalled();
    expect(mockImportFile).not.toHaveBeenCalled();
  });
});
