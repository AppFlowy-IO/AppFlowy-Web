jest.mock('@/utils/md5', () => ({
  calculateMd5: jest.fn().mockResolvedValue('md5-base64'),
}));

jest.mock('@/application/services/js-services/http/collab-api', () => ({
  getCollab: jest.fn(),
  updateCollab: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/import-api', () => ({
  createDatabaseCsvImportTask: jest.fn(),
  uploadDatabaseCsvImportFile: jest.fn(),
  getDatabaseCsvImportStatus: jest.fn(),
  cancelDatabaseCsvImportTask: jest.fn(),
  cancelImportTask: jest.fn(),
  createNotionImportTask: jest.fn(),
  createConfluenceImportTask: jest.fn(),
  uploadImportFile: jest.fn(),
  uploadImportFileMultipart: jest.fn(),
  createDocumentFileImportTask: jest.fn(),
  uploadDocumentFileImportFile: jest.fn(),
  getDocumentFileImportStatus: jest.fn(),
}));

import {
  cancelImportTask,
  createDocumentFileImportTask,
  getDocumentFileImportStatus,
  uploadDocumentFileImportFile,
} from '@/application/services/js-services/http/import-api';
import {
  DOCUMENT_FILE_MAX_BYTES,
  DocumentFileTooLargeError,
  ImportAbortError,
  importDocumentFile,
  importDocumentFiles,
} from '@/components/app/import/import-service';
import { calculateMd5 } from '@/utils/md5';

const createTask = createDocumentFileImportTask as jest.Mock;
const upload = uploadDocumentFileImportFile as jest.Mock;
const getStatus = getDocumentFileImportStatus as jest.Mock;
const cancelTask = cancelImportTask as jest.Mock;

const WORKSPACE_ID = 'workspace-1';
const PARENT_VIEW_ID = 'parent-view-1';

function file(name: string, type = 'application/pdf', size = 10): File {
  const f = new File(['x'.repeat(size)], name, { type });

  return f;
}

describe('importDocumentFile', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.mocked(calculateMd5).mockResolvedValue('md5-base64');
    createTask.mockResolvedValue({ task_id: 'task-1', presigned_url: 'https://s3.test/doc', expires_in_secs: 1800 });
    upload.mockResolvedValue(undefined);
    cancelTask.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates the task with the file name and format, uploads with the format content type, and polls to the view id', async () => {
    getStatus
      .mockResolvedValueOnce({ task_id: 'task-1', status: 'Pending' })
      .mockResolvedValueOnce({ task_id: 'task-1', status: 'Processing' })
      .mockResolvedValueOnce({
        task_id: 'task-1',
        status: 'Completed',
        view_id: 'view-9',
        diagnostics: { warnings: [{ code: 'pdf_images_not_imported', count: 1, message: 'Images were not imported' }] },
      });

    const promise = importDocumentFile({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      file: file('Plan.pdf'),
      format: 'pdf',
    });

    // Two polls sleep between them; advance the clock until the third resolves.
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(2000);
    }

    await expect(promise).resolves.toEqual({
      viewId: 'view-9',
      warnings: [{ code: 'pdf_images_not_imported', count: 1, message: 'Images were not imported' }],
    });
    expect(createTask).toHaveBeenCalledWith(WORKSPACE_ID, {
      content_length: 10,
      md5_base64: 'md5-base64',
      file_name: 'Plan.pdf',
      format: 'pdf',
      parent_view_id: PARENT_VIEW_ID,
    });
    expect(upload).toHaveBeenCalledWith('https://s3.test/doc', expect.any(File), 'pdf', undefined, undefined);
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('surfaces the server error of a failed task and cancels it best-effort', async () => {
    getStatus.mockResolvedValue({ task_id: 'task-1', status: 'Failed', error: 'run OCR on it before importing' });

    await expect(
      importDocumentFile({ workspaceId: WORKSPACE_ID, parentViewId: PARENT_VIEW_ID, file: file('scan.pdf'), format: 'pdf' })
    ).rejects.toThrow('run OCR on it before importing');
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });

  it('rejects oversized files before creating a task', async () => {
    const big = file('huge.pdf', 'application/pdf', DOCUMENT_FILE_MAX_BYTES.pdf + 1);

    await expect(
      importDocumentFile({ workspaceId: WORKSPACE_ID, parentViewId: PARENT_VIEW_ID, file: big, format: 'pdf' })
    ).rejects.toBeInstanceOf(DocumentFileTooLargeError);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('turns an abort during polling into ImportAbortError and cancels the task', async () => {
    const controller = new AbortController();

    getStatus.mockImplementation(async () => {
      controller.abort();
      return { task_id: 'task-1', status: 'Processing' };
    });

    await expect(
      importDocumentFile({
        workspaceId: WORKSPACE_ID,
        parentViewId: PARENT_VIEW_ID,
        file: file('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        format: 'docx',
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(ImportAbortError);
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });
});

describe('importDocumentFiles', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(calculateMd5).mockResolvedValue('md5-base64');
    createTask.mockImplementation(async (_ws: string, payload: { file_name: string }) => ({
      task_id: `task-${payload.file_name}`,
      presigned_url: `https://s3.test/${payload.file_name}`,
      expires_in_secs: 1800,
    }));
    upload.mockResolvedValue(undefined);
    cancelTask.mockResolvedValue(undefined);
  });

  it('imports files one at a time, records per-file failures and keeps going', async () => {
    getStatus.mockImplementation(async (_ws: string, taskId: string) =>
      taskId === 'task-b.html'
        ? { task_id: taskId, status: 'Failed', error: 'not html' }
        : { task_id: taskId, status: 'Completed', view_id: `view-${taskId}` }
    );
    const onFileStart = jest.fn();

    const result = await importDocumentFiles({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [file('a.html', 'text/html'), file('b.html', 'text/html'), file('c.html', 'text/html')],
      format: 'html',
      onFileStart,
    });

    expect(result).toEqual({
      items: [
        { fileName: 'a.html', viewId: 'view-task-a.html' },
        { fileName: 'b.html', error: 'not html' },
        { fileName: 'c.html', viewId: 'view-task-c.html' },
      ],
      aborted: false,
    });
    expect(onFileStart.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    // Sequential: the second task is created only after the first completed.
    expect(createTask.mock.invocationCallOrder[1]).toBeGreaterThan(getStatus.mock.invocationCallOrder[0]);
  });

  it('stops the batch on the pending-task cap and reports the server message once', async () => {
    createTask
      .mockResolvedValueOnce({ task_id: 'task-1', presigned_url: 'u', expires_in_secs: 1 })
      .mockRejectedValueOnce({ code: 1046, message: '3 import tasks are pending' });
    getStatus.mockResolvedValue({ task_id: 'task-1', status: 'Completed', view_id: 'view-1' });

    const result = await importDocumentFiles({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [file('a.docx'), file('b.docx'), file('c.docx')],
      format: 'docx',
    });

    expect(result.aborted).toBe(false);
    expect(result.items).toEqual([
      { fileName: 'a.docx', viewId: 'view-1' },
      { fileName: 'b.docx', error: '3 import tasks are pending' },
    ]);
    expect(createTask).toHaveBeenCalledTimes(2);
  });
});
