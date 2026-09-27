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
      importDocumentFile({
        workspaceId: WORKSPACE_ID,
        parentViewId: PARENT_VIEW_ID,
        file: file('scan.pdf'),
        format: 'pdf',
      })
    ).rejects.toThrow('run OCR on it before importing');
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });

  it.each([
    ['pdf', 30],
    ['docx', 60],
    ['html', 60],
  ] as const)('allows a %s file above the server default when task creation accepts it', async (format, sizeMiB) => {
    const big = file(`large.${format}`);

    Object.defineProperty(big, 'size', { value: sizeMiB * 1024 * 1024 });
    getStatus.mockResolvedValue({ task_id: 'task-1', status: 'Completed', view_id: 'view-large' });

    await expect(
      importDocumentFile({ workspaceId: WORKSPACE_ID, parentViewId: PARENT_VIEW_ID, file: big, format })
    ).resolves.toEqual({ viewId: 'view-large', warnings: [] });
    expect(createTask).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({ content_length: big.size, format })
    );
    expect(upload).toHaveBeenCalledWith('https://s3.test/doc', big, format, undefined, undefined);
  });

  it('surfaces the configured server size limit without uploading a rejected file', async () => {
    const error = new Error('PDF exceeds the configured 5 MiB limit');
    const oversized = file('large.pdf');

    Object.defineProperty(oversized, 'size', { value: 6 * 1024 * 1024 });
    createTask.mockRejectedValue(error);

    await expect(
      importDocumentFile({ workspaceId: WORKSPACE_ID, parentViewId: PARENT_VIEW_ID, file: oversized, format: 'pdf' })
    ).rejects.toBe(error);
    expect(upload).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it.each(['Processing', 'Completed'])('rejects a %s response received after cancellation', async (status) => {
    const controller = new AbortController();

    getStatus.mockImplementation(async () => {
      controller.abort();
      return { task_id: 'task-1', status, view_id: 'view-1' };
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

  it.each([1, 2])('marks a %s-file batch aborted when the last status request completes after cancellation', async (count) => {
    const controller = new AbortController();
    const files = Array.from({ length: count }, (_, index) => file(`${index}.pdf`));
    const lastTaskId = `task-${files[count - 1].name}`;

    getStatus.mockImplementation(async (_ws: string, taskId: string) => {
      if (taskId === lastTaskId) controller.abort();
      return { task_id: taskId, status: 'Completed', view_id: `view-${taskId}` };
    });

    const result = await importDocumentFiles({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files,
      format: 'pdf',
      signal: controller.signal,
    });

    expect(result).toEqual({
      items: files.slice(0, -1).map((item) => ({ fileName: item.name, viewId: `view-task-${item.name}` })),
      aborted: true,
    });
    expect(createTask).toHaveBeenCalledTimes(count);
    expect(cancelTask).toHaveBeenCalledWith(lastTaskId);
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
      { fileName: 'b.docx', error: '3 import tasks are pending', code: 1046 },
    ]);
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it.each(['request', 'worker'])(
    'stops further uploads when a %s reports exhausted workspace storage',
    async (stage) => {
      const message = 'Workspace storage is full. Upgrade this workspace to Pro for unlimited storage.';

      if (stage === 'request') {
        createTask.mockRejectedValueOnce({ code: 1028, message });
      } else {
        getStatus.mockResolvedValueOnce({ task_id: 'task-a.pdf', status: 'Failed', error: message, error_code: 1028 });
      }

      const result = await importDocumentFiles({
        workspaceId: WORKSPACE_ID,
        parentViewId: PARENT_VIEW_ID,
        files: [file('a.pdf'), file('b.pdf')],
        format: 'pdf',
      });

      expect(result).toEqual({ items: [{ fileName: 'a.pdf', error: message, code: 1028 }], aborted: false });
      expect(createTask).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledTimes(stage === 'request' ? 0 : 1);
    }
  );

  it('preserves attachment-size errors and continues with the next file', async () => {
    getStatus
      .mockResolvedValueOnce({
        task_id: 'task-a.docx',
        status: 'Failed',
        error: 'Attachment exceeds 7 MiB',
        error_code: 1037,
      })
      .mockResolvedValueOnce({ task_id: 'task-b.docx', status: 'Completed', view_id: 'view-b' });

    const result = await importDocumentFiles({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [file('a.docx'), file('b.docx')],
      format: 'docx',
    });

    expect(result.items).toEqual([
      { fileName: 'a.docx', error: 'Attachment exceeds 7 MiB', code: 1037 },
      { fileName: 'b.docx', viewId: 'view-b' },
    ]);
    expect(createTask).toHaveBeenCalledTimes(2);
  });
});
