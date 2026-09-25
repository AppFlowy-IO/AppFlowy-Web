import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { importCsvFilesAsDatabases, importDocumentFiles } from '@/components/app/import/import-service';
import ImportDialog from '@/components/app/import/ImportDialog';

const toView = jest.fn();

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({ addPage: jest.fn() }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useOpenPageModal: () => jest.fn(),
  useToView: () => toView,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && ('name' in options || 'count' in options) ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

jest.mock('@/components/app/import/import-service', () => ({
  ImportAbortError: class ImportAbortError extends Error {},
  importConfluenceZipToView: jest.fn(),
  importNotionZipToView: jest.fn(),
  importCsvFilesAsDatabases: jest.fn(),
  importDocumentFiles: jest.fn(),
  populateDocumentWithMarkdown: jest.fn(),
  stripFileExtension: (name: string) => name,
}));

const importDocs = importDocumentFiles as jest.MockedFunction<typeof importDocumentFiles>;

function renderDialog() {
  const onOpenChange = jest.fn();
  const result = render(<ImportDialog open parentViewId='parent-1' onOpenChange={onOpenChange} />);

  return { ...result, onOpenChange };
}

function pick(testId: string, files: File[]) {
  fireEvent.change(screen.getByTestId(testId), { target: { files } });
}

describe('ImportDialog document file tiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    importDocs.mockReset();
  });

  it.each([
    ['html', '.html,.htm,text/html'],
    ['docx', '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['pdf', '.pdf,application/pdf'],
  ])('the %s tile opens a multi-file picker restricted to its format', (format, accept) => {
    renderDialog();

    const input = screen.getByTestId(`import-${format}-input`);
    const click = jest.spyOn(input, 'click');

    fireEvent.click(screen.getByTestId(`import-${format}`));

    expect(click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe(accept);
    expect(input.multiple).toBe(true);
    click.mockRestore();
  });

  it('imports the picked files sequentially under the current parent and opens the first page', async () => {
    importDocs.mockResolvedValue({
      items: [
        { fileName: 'a.docx', viewId: 'view-a' },
        { fileName: 'b.docx', viewId: 'view-b' },
      ],
      aborted: false,
    });
    const { onOpenChange } = renderDialog();
    const files = [new File(['a'], 'a.docx'), new File(['b'], 'b.docx')];

    pick('import-docx-input', files);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(importDocs).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      parentViewId: 'parent-1',
      files,
      format: 'docx',
      signal: expect.any(AbortSignal),
      onFileStart: expect.any(Function),
    });
    expect(importCsvFilesAsDatabases).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('importPanel.successCount:{"count":2}');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toView).toHaveBeenCalledWith('view-a');
  });

  it('reports converter warnings and failed files, and stays open when files remain', async () => {
    importDocs.mockResolvedValue({
      items: [
        {
          fileName: 'scan.pdf',
          error: 'this PDF has no selectable text; run OCR on it before importing',
        },
        {
          fileName: 'report.pdf',
          viewId: 'view-r',
          warnings: [{ code: 'pdf_images_not_imported', count: 1, message: 'Images were not imported' }],
        },
      ],
      aborted: true,
    });
    const { onOpenChange } = renderDialog();

    pick('import-pdf-input', [new File(['s'], 'scan.pdf'), new File(['r'], 'report.pdf'), new File(['t'], 'third.pdf')]);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'importPanel.failedFile:{"name":"scan.pdf","reason":"this PDF has no selectable text; run OCR on it before importing"'
      )
    );
    expect(toast.success).toHaveBeenCalledWith('importPanel.success');
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'importPanel.importedWithWarnings:{"name":"report.pdf","summary":"Images were not imported"'
      )
    );
    // Cancelled mid-batch: the dialog stays open so the third file can be retried.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toView).not.toHaveBeenCalled();
  });

  it.each([
    ['pdf', 30],
    ['docx', 60],
    ['html', 60],
  ] as const)('sends all %s files for server size validation', async (format, sizeMiB) => {
    const small = new File(['s'], `small.${format}`);
    const big = new File(['b'], `big.${format}`);

    Object.defineProperty(big, 'size', { value: sizeMiB * 1024 * 1024 });
    importDocs.mockResolvedValue({
      items: [
        { fileName: big.name, viewId: 'view-b' },
        { fileName: small.name, viewId: 'view-s' },
      ],
      aborted: false,
    });
    const { onOpenChange } = renderDialog();

    pick(`import-${format}-input`, [big, small]);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(importDocs.mock.calls[0][0].files).toEqual([big, small]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not navigate when a successful batch result arrives after the dialog is cancelled', async () => {
    let resolveBatch!: (result: Awaited<ReturnType<typeof importDocumentFiles>>) => void;

    importDocs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve;
        })
    );
    const { onOpenChange } = renderDialog();

    pick('import-pdf-input', [new File(['x'], 'report.pdf')]);
    await waitFor(() => expect(importDocs).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('import-dialog-close'));

    expect(importDocs.mock.calls[0][0].signal?.aborted).toBe(true);
    await act(async () => {
      resolveBatch({ items: [{ fileName: 'report.pdf', viewId: 'view-r' }], aborted: false });
    });

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toView).not.toHaveBeenCalled();
  });

  it.each([1028, 1015])(
    'shows a storage prompt for quota code %s even alongside an earlier conversion failure',
    async (code) => {
      importDocs.mockResolvedValue({
        items: [
          { fileName: 'broken.pdf', error: 'Run OCR before importing' },
          { fileName: 'report.pdf', error: 'Server quota message', code },
        ],
        aborted: false,
      });
      const { onOpenChange } = renderDialog();

      pick('import-pdf-input', [
        new File(['x'], 'broken.pdf'),
        new File(['x'], 'report.pdf'),
        new File(['x'], 'next.pdf'),
      ]);

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('importPanel.storageLimitExceeded'));
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Run OCR before importing'));
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(toView).not.toHaveBeenCalled();
    }
  );

  it('keeps the dialog open when the last file hits the storage limit after a successful import', async () => {
    importDocs.mockResolvedValue({
      items: [
        { fileName: 'first.docx', viewId: 'view-first' },
        { fileName: 'second.docx', error: 'Quota', code: 1028 },
      ],
      aborted: false,
    });
    const { onOpenChange } = renderDialog();

    pick('import-docx-input', [new File(['x'], 'first.docx'), new File(['x'], 'second.docx')]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('importPanel.storageLimitExceeded'));
    expect(toast.success).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toView).not.toHaveBeenCalled();
  });

  it.each([1017, 1037])('does not mislabel error code %s as exhausted workspace storage', async (code) => {
    importDocs.mockResolvedValue({
      items: [{ fileName: 'report.pdf', error: 'Specific server error', code }],
      aborted: false,
    });
    renderDialog();

    pick('import-pdf-input', [new File(['x'], 'report.pdf')]);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Specific server error'));
    expect(toast.error).not.toHaveBeenCalledWith('importPanel.storageLimitExceeded');
  });

  it('shows the batch counter and lets the close button cancel the batch', async () => {
    let resolveBatch: (value: { items: []; aborted: boolean }) => void = () => undefined;

    importDocs.mockImplementation(
      ({ onFileStart, signal }) =>
        new Promise((resolve) => {
          onFileStart?.(1, 3);
          signal?.addEventListener('abort', () => resolve({ items: [], aborted: true }));
          resolveBatch = resolve;
        })
    );
    const { onOpenChange } = renderDialog();

    pick('import-html-input', [new File(['1'], '1.html'), new File(['2'], '2.html'), new File(['3'], '3.html')]);

    await waitFor(() => expect(screen.queryByTestId('import-html-progress')).not.toBeNull());
    expect(screen.getByTestId('import-html-progress').textContent).toContain('importPanel.importingCount');
    expect(screen.getByTestId('import-pdf').disabled).toBe(true);

    const close = screen.getByTestId('import-dialog-close');

    expect(close.disabled).toBe(false);
    fireEvent.click(close);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(importDocs.mock.calls[0][0].signal?.aborted).toBe(true);
    resolveBatch({ items: [], aborted: true });
  });
});
