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
}));

import {
  cancelImportTask,
  createConfluenceImportTask,
  createNotionImportTask,
  uploadImportFile,
  uploadImportFileMultipart,
} from '@/application/services/js-services/http/import-api';
import {
  ImportAbortError,
  importConfluenceZipToView,
  importNotionZipToView,
} from '@/components/app/import/import-service';
import { calculateMd5 } from '@/utils/md5';

const uploadSingle = uploadImportFile as jest.Mock;
const uploadMultipart = uploadImportFileMultipart as jest.Mock;
const cancelTask = cancelImportTask as jest.Mock;

const WORKSPACE_ID = 'workspace-1';
const PARENT_VIEW_ID = 'parent-view-1';

function zipFile(): File {
  return new File(['zip-bytes'], 'export.zip', { type: 'application/zip' });
}

describe.each([
  ['Notion', importNotionZipToView, createNotionImportTask, createConfluenceImportTask],
  ['Confluence', importConfluenceZipToView, createConfluenceImportTask, createNotionImportTask],
] as const)('%s ZIP import', (_source, importToView, createTaskFunction, otherCreateTask) => {
  const createTask = jest.mocked(createTaskFunction);

  function importZip(signal?: AbortSignal) {
    return importToView({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      file: zipFile(),
      signal,
    });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(calculateMd5).mockResolvedValue('md5-base64');
    cancelTask.mockResolvedValue(undefined);
    uploadSingle.mockResolvedValue(undefined);
    uploadMultipart.mockResolvedValue(undefined);
    createTask.mockResolvedValue({ taskId: 'task-1', presignedUrl: 'https://s3.test/zip', multipart: null });
  });

  it('creates the selected source task and uploads the exact file to its destination', async () => {
    const file = zipFile();
    const onProgress = jest.fn();

    await expect(
      importToView({
        workspaceId: WORKSPACE_ID,
        parentViewId: PARENT_VIEW_ID,
        file,
        onProgress,
      })
    ).resolves.toEqual({ taskId: 'task-1' });

    expect(calculateMd5).toHaveBeenCalledWith(file);
    expect(createTask).toHaveBeenCalledWith(WORKSPACE_ID, PARENT_VIEW_ID, {
      content_length: file.size,
      md5_base64: 'md5-base64',
    });
    expect(otherCreateTask).not.toHaveBeenCalled();
    expect(uploadSingle).toHaveBeenCalledWith('https://s3.test/zip', file, onProgress, undefined);
    expect(uploadMultipart).not.toHaveBeenCalled();
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('does not create a task when cancelled before upload preparation', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(importZip(controller.signal)).rejects.toBeInstanceOf(ImportAbortError);
    expect(calculateMd5).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(uploadSingle).not.toHaveBeenCalled();
  });

  it('cancels a task created while the caller was aborting', async () => {
    const controller = new AbortController();

    createTask.mockImplementation(async () => {
      controller.abort();
      return { taskId: 'task-1', presignedUrl: 'https://s3.test/zip', multipart: null };
    });

    await expect(importZip(controller.signal)).rejects.toBeInstanceOf(ImportAbortError);
    expect(uploadSingle).not.toHaveBeenCalled();
    expect(uploadMultipart).not.toHaveBeenCalled();
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });

  it('hands the signal to a single-part upload so a cancel reaches the request', async () => {
    const controller = new AbortController();

    await importZip(controller.signal);

    expect(uploadSingle).toHaveBeenCalledWith(
      'https://s3.test/zip',
      expect.anything(),
      expect.any(Function),
      controller.signal
    );
  });

  it('hands the signal to a multipart upload too — the longest path in the dialog', async () => {
    const multipart = { s3_key: 'key', upload_id: 'upload-1', part_presigned_urls: [] };

    createTask.mockResolvedValue({ taskId: 'task-1', presignedUrl: 'https://s3.test/zip', multipart });

    const controller = new AbortController();

    await importZip(controller.signal);

    expect(uploadMultipart).toHaveBeenCalledWith(expect.anything(), multipart, expect.any(Function), controller.signal);
    expect(uploadSingle).not.toHaveBeenCalled();
  });

  it('reports a cancelled upload as an abort, not as a failed import', async () => {
    const controller = new AbortController();

    uploadSingle.mockImplementation(async () => {
      controller.abort();
      // axios rejects an aborted request with a CanceledError, never an ImportAbortError.
      throw Object.assign(new Error('canceled'), { name: 'CanceledError' });
    });

    // Without the normalisation the dialog would toast "canceled" as an import failure.
    await expect(importZip(controller.signal)).rejects.toBeInstanceOf(ImportAbortError);
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });

  it('still surfaces a genuine upload failure', async () => {
    uploadSingle.mockRejectedValue({ code: -1, message: 'Upload file failed. Bad Gateway' });

    await expect(importZip()).rejects.toEqual({ code: -1, message: 'Upload file failed. Bad Gateway' });
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });

  it('cancels the task on a multipart upload failure', async () => {
    createTask.mockResolvedValue({
      taskId: 'task-1',
      presignedUrl: '',
      multipart: { s3_key: 'key', upload_id: 'upload-1', part_presigned_urls: [] },
    });
    uploadMultipart.mockRejectedValue(new Error('Part upload failed'));

    await expect(importZip()).rejects.toThrow('Part upload failed');
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });

  it('does not report success when cancellation races with upload completion', async () => {
    const controller = new AbortController();

    uploadSingle.mockImplementation(async () => controller.abort());

    await expect(importZip(controller.signal)).rejects.toBeInstanceOf(ImportAbortError);
    expect(cancelTask).toHaveBeenCalledWith('task-1');
  });
});
