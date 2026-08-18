import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import {
  importCsvFilesAsDatabases,
  ImportCsvBatchInput,
  importNotionZipToView,
} from '@/components/app/import/import-service';
import ImportDialog from '@/components/app/import/ImportDialog';

const toView = jest.fn();
const addPage = jest.fn();

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ addPage }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useOpenPageModal: () => jest.fn(),
  useToView: () => toView,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // `interpolation` is an i18next directive, not a placeholder value — real `t` consumes it,
    // so the stub drops it too and only echoes the values that get substituted.
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;

      const { interpolation: _interpolation, ...values } = options;

      return Object.keys(values).length > 0 ? `${key}:${JSON.stringify(values)}` : key;
    },
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/components/app/import/import-service', () => ({
  ImportAbortError: class ImportAbortError extends Error {},
  importCsvFilesAsDatabases: jest.fn(),
  importNotionZipToView: jest.fn(),
  populateDocumentWithMarkdown: jest.fn(),
  stripFileExtension: (name: string) => name,
}));

const toastSuccess = toast.success as unknown as jest.Mock;
const toastError = toast.error as unknown as jest.Mock;
const importCsv = importCsvFilesAsDatabases as jest.Mock;
const importNotion = importNotionZipToView as jest.Mock;

const PARENT_VIEW_ID = 'parent-1';

function renderDialog() {
  const onOpenChange = jest.fn();

  render(<ImportDialog open parentViewId={PARENT_VIEW_ID} onOpenChange={onOpenChange} />);

  return { onOpenChange };
}

function pickNotionFile() {
  const input = screen.getByTestId('import-notion-input');
  const file = new File(['zip'], 'export.zip', { type: 'application/zip' });

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function closeButton(): HTMLButtonElement {
  return screen.getByTestId('import-dialog-close');
}

function pickCsvFiles(names: string[]) {
  const input = screen.getByTestId('import-csv-input');
  const files = names.map((name) => new File(['name,age\nada,36'], name, { type: 'text/csv' }));

  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);

  return files;
}

describe('ImportDialog — multiple CSV files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    importCsv.mockResolvedValue({ items: [], aborted: false });
  });

  it('lets the file picker select more than one CSV', () => {
    renderDialog();

    expect((screen.getByTestId('import-csv-input')).multiple).toBe(true);
  });

  it('forwards every selected file to the batch import and opens the first new grid', async () => {
    importCsv.mockResolvedValue({
      items: [
        { fileName: 'one.csv', viewId: 'view-1' },
        { fileName: 'two.csv', viewId: 'view-2' },
        { fileName: 'three.csv', viewId: 'view-3' },
      ],
      aborted: false,
    });

    const { onOpenChange } = renderDialog();
    const files = pickCsvFiles(['one.csv', 'two.csv', 'three.csv']);

    await waitFor(() => expect(toView).toHaveBeenCalledWith('view-1'));

    expect(importCsv).toHaveBeenCalledTimes(1);

    const batchInput = importCsv.mock.calls[0][0] as ImportCsvBatchInput;

    expect(batchInput.workspaceId).toBe('workspace-1');
    expect(batchInput.parentViewId).toBe(PARENT_VIEW_ID);
    expect(batchInput.files).toHaveLength(files.length);
    expect(batchInput.files.map((file) => file.name)).toEqual(['one.csv', 'two.csv', 'three.csv']);
    expect(batchInput.files[0]).toBe(files[0]);
    expect(toastSuccess).toHaveBeenCalledWith('importPanel.successCount:{"count":3}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the single-file wording when only one CSV is picked', async () => {
    importCsv.mockResolvedValue({ items: [{ fileName: 'one.csv', viewId: 'view-1' }], aborted: false });

    renderDialog();
    pickCsvFiles(['one.csv']);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('importPanel.success'));
  });

  it('reports the files that failed while still opening the ones that worked', async () => {
    importCsv.mockResolvedValue({
      items: [
        { fileName: 'one.csv', viewId: 'view-1' },
        { fileName: 'two.csv', error: 'file too large' },
        { fileName: 'three.csv', error: 'bad header' },
      ],
      aborted: false,
    });

    renderDialog();
    pickCsvFiles(['one.csv', 'two.csv', 'three.csv']);

    await waitFor(() => expect(toView).toHaveBeenCalledWith('view-1'));
    expect(toastSuccess).toHaveBeenCalledWith('importPanel.partialSuccess:{"success":1,"count":3}');
    expect(toastError).toHaveBeenCalledWith('importPanel.failedFiles:{"names":"two.csv, three.csv"}');
  });

  it('translates the overflow marker instead of appending a bare +N', async () => {
    importCsv.mockResolvedValue({
      items: ['a.csv', 'b.csv', 'c.csv', 'd.csv', 'e.csv'].map((fileName) => ({ fileName, error: 'bad header' })),
      aborted: false,
    });

    renderDialog();
    pickCsvFiles(['a.csv', 'b.csv', 'c.csv', 'd.csv', 'e.csv']);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'importPanel.failedFilesOverflow:{"names":"a.csv, b.csv, c.csv","count":2}'
      )
    );
  });

  it('translates the reason when a failure carried no message', async () => {
    importCsv.mockResolvedValue({ items: [{ fileName: 'one.csv', error: '' }], aborted: false });

    renderDialog();
    pickCsvFiles(['one.csv']);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'importPanel.failedFile:{"name":"one.csv","reason":"importPanel.failed"}'
      )
    );
  });

  it('labels the close button as a cancel while a batch runs', async () => {
    renderDialog();

    expect(screen.getByTestId('import-dialog-close').getAttribute('aria-label')).toBe('button.close');

    importCsv.mockImplementation(() => new Promise(() => undefined));
    pickCsvFiles(['one.csv', 'two.csv']);

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog-close').getAttribute('aria-label')).toBe('importPanel.cancelImport')
    );
  });

  it('names the offending file when exactly one of many fails', async () => {
    importCsv.mockResolvedValue({
      items: [
        { fileName: 'one.csv', viewId: 'view-1' },
        { fileName: 'two.csv', error: 'file too large' },
        { fileName: 'three.csv', viewId: 'view-3' },
      ],
      aborted: false,
    });

    renderDialog();
    pickCsvFiles(['one.csv', 'two.csv', 'three.csv']);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'importPanel.failedFile:{"name":"two.csv","reason":"file too large"}'
      )
    );
  });

  it('still reports files that failed before the batch was cancelled', async () => {
    importCsv.mockResolvedValue({
      items: [
        { fileName: 'one.csv', viewId: 'view-1' },
        { fileName: 'two.csv', error: 'bad header' },
      ],
      aborted: true,
    });

    renderDialog();
    pickCsvFiles(['one.csv', 'two.csv', 'three.csv']);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('importPanel.failedFile:{"name":"two.csv","reason":"bad header"}')
    );
    // The third file was never attempted, so it must not be counted as a failure.
    expect(toastSuccess).toHaveBeenCalledWith('importPanel.success');
    expect(toView).not.toHaveBeenCalled();
  });

  it('stays open and navigates nowhere when every file fails', async () => {
    importCsv.mockResolvedValue({
      items: [
        { fileName: 'one.csv', error: 'file too large' },
        { fileName: 'two.csv', error: 'bad header' },
      ],
      aborted: false,
    });

    const { onOpenChange } = renderDialog();

    pickCsvFiles(['one.csv', 'two.csv']);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toView).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows how far along the batch is', async () => {
    let reportProgress: ((index: number, total: number) => void) | undefined;

    importCsv.mockImplementation(
      (input: ImportCsvBatchInput) =>
        new Promise(() => {
          reportProgress = input.onFileStart;
        })
    );

    renderDialog();
    pickCsvFiles(['one.csv', 'two.csv', 'three.csv']);

    await waitFor(() => expect(reportProgress).toBeDefined());
    expect(screen.getByTestId('import-csv-progress').textContent).toBe(
      'importPanel.importingCount:{"current":1,"total":3}'
    );

    act(() => reportProgress?.(1, 3));

    await waitFor(() =>
      expect(screen.getByTestId('import-csv-progress').textContent).toBe(
        'importPanel.importingCount:{"current":2,"total":3}'
      )
    );
  });

  it('announces batch progress from outside the disabled button', async () => {
    await startPendingBatch();

    // Screen readers skip the counter rendered inside the disabled CSV button, so the same
    // progress has to reach them through a live region.
    expect(screen.getByTestId('import-csv-progress-announcement').textContent).toBe(
      'importPanel.importingProgress:{"current":1,"total":2}'
    );
  });

  it('reports no denominator when the batch gave up before every file got a turn', async () => {
    // The server's pending-task cap halts the batch at the second file; the third never ran.
    importCsv.mockResolvedValue({
      items: [
        { fileName: 'one.csv', viewId: 'view-1' },
        { fileName: 'two.csv', error: '3 import tasks are pending. Please wait until they are completed' },
      ],
      aborted: false,
    });

    const { onOpenChange } = renderDialog();

    pickCsvFiles(['one.csv', 'two.csv', 'three.csv']);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // "Imported 1 of 3" would count a file that was never attempted as a loss.
    expect(toastSuccess).toHaveBeenCalledWith('importPanel.success');
    expect(toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining('partialSuccess'));
    // The untried file is still worth retrying, so the dialog stays put.
    expect(toView).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('lets a long Notion upload be cancelled instead of trapping the dialog', async () => {
    let notionInput: { signal?: AbortSignal } | undefined;

    importNotion.mockImplementation(
      (input: { signal?: AbortSignal }) =>
        new Promise(() => {
          notionInput = input;
        })
    );

    const { onOpenChange } = renderDialog();

    pickNotionFile();
    await waitFor(() => expect(notionInput).toBeDefined());

    expect(closeButton().disabled).toBe(false);
    expect(closeButton().getAttribute('aria-label')).toBe('importPanel.cancelImport');
    expect(notionInput?.signal?.aborted).toBe(false);

    fireEvent.click(closeButton());

    expect(notionInput?.signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('still blocks the close button while a markdown import is mid-flight', async () => {
    addPage.mockImplementation(() => new Promise(() => undefined));

    renderDialog();

    const input = screen.getByTestId('import-markdown-input');

    Object.defineProperty(input, 'files', {
      value: [new File(['# hi'], 'notes.md', { type: 'text/markdown' })],
      configurable: true,
    });
    fireEvent.change(input);

    // Markdown has already created its page by this point — cancelling would strand an empty one.
    await waitFor(() => expect(closeButton().disabled).toBe(true));
    expect(closeButton().getAttribute('aria-label')).toBe('button.close');
  });

  it('cancels the running batch when the close button is clicked', async () => {
    const { batchInput, onOpenChange } = await startPendingBatch();

    expect(batchInput()?.signal?.aborted).toBe(false);

    fireEvent.click(screen.getByTestId('import-dialog-close'));

    expect(batchInput()?.signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not let a stray backdrop click or Escape throw the batch away', async () => {
    const { batchInput, onOpenChange } = await startPendingBatch();

    fireEvent.keyDown(screen.getByTestId('import-dialog'), { key: 'Escape', code: 'Escape' });
    fireEvent.click(document.querySelector('.MuiBackdrop-root') as HTMLElement);

    expect(batchInput()?.signal?.aborted).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

/** Render the dialog with a CSV batch that never settles, so the in-flight UI stays put. */
async function startPendingBatch() {
  let input: ImportCsvBatchInput | undefined;

  importCsv.mockImplementation(
    (batch: ImportCsvBatchInput) =>
      new Promise(() => {
        input = batch;
      })
  );

  const onOpenChange = jest.fn();

  render(<ImportDialog open parentViewId={PARENT_VIEW_ID} onOpenChange={onOpenChange} />);
  pickCsvFiles(['one.csv', 'two.csv']);
  await waitFor(() => expect(input).toBeDefined());

  return { batchInput: () => input, onOpenChange };
}
