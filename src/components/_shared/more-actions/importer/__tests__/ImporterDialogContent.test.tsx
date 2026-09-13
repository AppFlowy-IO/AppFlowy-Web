import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FileService } from '@/application/services/domains';
import { notify } from '@/components/_shared/notify';

import ImporterDialogContent from '../ImporterDialogContent';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));

jest.mock('@/application/services/domains', () => ({
  FileService: {
    CreateImportTaskType: {
      Notion: 'Notion',
      Workspace: 'Workspace',
      Confluence: 'Confluence',
    },
    importFile: jest.fn(),
  },
}));

const importFile = FileService.importFile as jest.MockedFunction<typeof FileService.importFile>;

function uploadVisibleFile(file: File) {
  const input = screen.getByTestId('file-dropzone').querySelector('input');

  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
}

describe('ImporterDialogContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    importFile.mockResolvedValue(undefined);
  });

  it.each([
    ['appflowy', FileService.CreateImportTaskType.Workspace],
    ['notion', FileService.CreateImportTaskType.Notion],
    ['confluence', FileService.CreateImportTaskType.Confluence],
  ] as const)('routes the %s tab to the matching import task type', async (source, taskType) => {
    const file = new File(['workspace'], `${source}.zip`, { type: 'application/zip' });

    render(<ImporterDialogContent source={source} onSuccess={jest.fn()} />);
    uploadVisibleFile(file);

    await waitFor(() => {
      expect(importFile).toHaveBeenCalledWith(file, {
        taskType,
        onProgress: expect.any(Function),
      });
    });
  });

  it('lets users select Confluence and asks for an HTML export ZIP', async () => {
    const onSuccess = jest.fn();
    const file = new File(['confluence'], 'space.html.zip', { type: 'application/zip' });

    render(<ImporterDialogContent onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('tab', { name: 'web.importFromConfluence' }));

    expect(screen.getByText('web.dropConfluenceFile')).toBeTruthy();
    uploadVisibleFile(file);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(importFile).toHaveBeenCalledWith(file, {
      taskType: FileService.CreateImportTaskType.Confluence,
      onProgress: expect.any(Function),
    });
  });

  it('keeps controls disabled through preparation and finalization, then allows retry after failure', async () => {
    let reportProgress: ((progress: number) => void) | undefined;
    let resolveImport: (() => void) | undefined;
    let rejectImport: ((error: Error) => void) | undefined;

    importFile.mockImplementation((_file, options) => {
      reportProgress = options?.onProgress;
      return new Promise((resolve, reject) => {
        resolveImport = resolve;
        rejectImport = reject;
      });
    });

    const onSuccess = jest.fn();
    const file = new File(['zip'], 'space.html.zip', { type: 'application/zip' });
    const expectControlsDisabled = (disabled: boolean) => {
      for (const tab of screen.getAllByRole('tab')) {
        expect((tab as HTMLButtonElement).disabled).toBe(disabled);
      }

      expect(screen.getByTestId('file-dropzone').querySelector('input')?.disabled).toBe(disabled);
    };

    render(<ImporterDialogContent source='confluence' onSuccess={onSuccess} />);
    uploadVisibleFile(file);
    await waitFor(() => expect(reportProgress).toBeDefined());
    // Task creation happens before the first upload progress callback.
    expectControlsDisabled(true);
    act(() => reportProgress?.(0.5));
    expectControlsDisabled(true);
    // Uploading the last byte does not finish multipart finalization.
    act(() => reportProgress?.(1));
    expectControlsDisabled(true);
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => rejectImport?.(new Error('Finalization failed')));
    expect(notify.error).toHaveBeenCalledWith('Finalization failed');
    expectControlsDisabled(false);

    uploadVisibleFile(file);
    expectControlsDisabled(true);
    expect(screen.queryByRole('progressbar', { value: { now: 100 } })).toBeNull();
    expect(importFile).toHaveBeenCalledTimes(2);

    expect(screen.getByRole('tab', { name: 'web.importFromConfluence' }).getAttribute('aria-selected')).toBe('true');
    act(() => reportProgress?.(1));
    expectControlsDisabled(true);
    await act(async () => resolveImport?.());
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expectControlsDisabled(false);
  });
});
