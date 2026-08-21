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
  uploadImportFile: jest.fn(),
  uploadImportFileMultipart: jest.fn(),
}));

import {
  cancelImportTask,
  createNotionImportTask,
  uploadImportFile,
  uploadImportFileMultipart,
} from '@/application/services/js-services/http/import-api';
import { ImportAbortError, importNotionZipToView } from '@/components/app/import/import-service';

const createTask = createNotionImportTask as jest.Mock;
const uploadSingle = uploadImportFile as jest.Mock;
const uploadMultipart = uploadImportFileMultipart as jest.Mock;
const cancelTask = cancelImportTask as jest.Mock;

const WORKSPACE_ID = 'workspace-1';
const PARENT_VIEW_ID = 'parent-view-1';

function zipFile(): File {
  return new File(['zip-bytes'], 'export.zip', { type: 'application/zip' });
}

function importZip(signal?: AbortSignal) {
  return importNotionZipToView({
    workspaceId: WORKSPACE_ID,
    parentViewId: PARENT_VIEW_ID,
    file: zipFile(),
    signal,
  });
}

describe('importNotionZipToView cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cancelTask.mockResolvedValue(undefined);
    uploadSingle.mockResolvedValue(undefined);
    uploadMultipart.mockResolvedValue(undefined);
    createTask.mockResolvedValue({ taskId: 'task-1', presignedUrl: 'https://s3.test/zip' });
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

    expect(uploadMultipart).toHaveBeenCalledWith(
      expect.anything(),
      multipart,
      expect.any(Function),
      controller.signal
    );
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
});
