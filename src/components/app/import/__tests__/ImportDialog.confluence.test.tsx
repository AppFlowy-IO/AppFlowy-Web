import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import {
  ImportAbortError,
  importConfluenceZipToView,
  importNotionZipToView,
} from '@/components/app/import/import-service';
import ImportDialog from '@/components/app/import/ImportDialog';

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ addPage: jest.fn() }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useOpenPageModal: () => jest.fn(),
  useToView: () => jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/app/import/import-service', () => ({
  ImportAbortError: class ImportAbortError extends Error {},
  importConfluenceZipToView: jest.fn(),
  importNotionZipToView: jest.fn(),
  importCsvFilesAsDatabases: jest.fn(),
  populateDocumentWithMarkdown: jest.fn(),
  stripFileExtension: (name: string) => name,
}));

const importConfluence = importConfluenceZipToView as jest.MockedFunction<typeof importConfluenceZipToView>;

function renderDialog() {
  const onOpenChange = jest.fn();
  const result = render(<ImportDialog open parentViewId='parent-1' onOpenChange={onOpenChange} />);

  return { ...result, onOpenChange };
}

function pickFile(file = new File(['html zip'], 'space.html.zip', { type: 'application/zip' })) {
  fireEvent.change(screen.getByTestId('import-confluence-input'), { target: { files: [file] } });
  return file;
}

describe('ImportDialog Confluence import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    importConfluence.mockReset();
    importConfluence.mockResolvedValue({ taskId: 'confluence-task' });
  });

  it('opens a single ZIP picker from the Confluence tile', () => {
    renderDialog();

    const input = screen.getByTestId('import-confluence-input');
    const click = jest.spyOn(input, 'click');

    fireEvent.click(screen.getByTestId('import-confluence'));

    expect(click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe('.zip,application/zip,application/x-zip,application/x-zip-compressed');
    expect(input.multiple).toBe(false);
    click.mockRestore();
  });

  it('imports the selected ZIP into the current workspace and parent and reports the queued import', async () => {
    const { onOpenChange } = renderDialog();
    const file = pickFile();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    expect(importConfluence).toHaveBeenCalledTimes(1);
    expect(importConfluence).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      parentViewId: 'parent-1',
      file,
      signal: expect.any(AbortSignal),
    });
    expect(importNotionZipToView).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('importPanel.confluenceImportStarted');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows loading, blocks other formats and accidental dismissal, and lets the user cancel', async () => {
    importConfluence.mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new ImportAbortError()), { once: true });
        })
    );

    const { onOpenChange } = renderDialog();

    pickFile();
    await waitFor(() => expect(importConfluence).toHaveBeenCalledTimes(1));

    const signal = importConfluence.mock.calls[0][0].signal;
    const close = screen.getByTestId('import-dialog-close');

    for (const format of ['markdown', 'csv', 'notion', 'confluence']) {
      expect(screen.getByTestId(`import-${format}`).disabled).toBe(true);
    }

    expect(within(screen.getByTestId('import-confluence')).getByRole('progressbar')).toBeTruthy();
    expect(close.disabled).toBe(false);
    expect(close.getAttribute('aria-label')).toBe('importPanel.cancelImport');

    fireEvent.keyDown(screen.getByTestId('import-dialog'), { key: 'Escape', code: 'Escape' });
    fireEvent.click(document.querySelector('.MuiBackdrop-root') as HTMLElement);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);

    fireEvent.click(close);

    expect(signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(within(screen.getByTestId('import-confluence')).queryByRole('progressbar')).toBeNull());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports an upload failure and lets the user retry the same file', async () => {
    importConfluence.mockRejectedValueOnce(new Error('Upload failed'));

    const { onOpenChange } = renderDialog();
    const file = pickFile();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Upload failed'));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId('import-confluence').disabled).toBe(false);
    expect(screen.getByTestId('import-confluence-input').value).toBe('');

    pickFile(file);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('importPanel.confluenceImportStarted'));
    expect(importConfluence).toHaveBeenCalledTimes(2);
    expect(importConfluence.mock.calls[1][0].file).toBe(file);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('aborts an unfinished upload when the dialog is unmounted', () => {
    importConfluence.mockImplementation(() => new Promise(() => undefined));

    const { unmount } = renderDialog();

    pickFile();

    const signal = importConfluence.mock.calls[0][0].signal;

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
