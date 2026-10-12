import { EventType, emit } from '@/application/session';

import {
  cancelImportTask,
  createImportTask,
  CreateImportTaskType,
  uploadImportFile,
  uploadImportFileMultipart,
} from '../http/import-api';
import { importFileWithUpload } from '../workspace-import';

let mockScope = 'account-a:server-a';

jest.mock('../http/workspace-creation-api', () => ({
  captureWorkspaceCreationContext: () => {
    const scope = mockScope;

    return () => {
      if (mockScope !== scope) throw new Error('Context changed');
    };
  },
}));
jest.mock('../http/import-api', () => ({
  createImportTask: jest.fn(),
  cancelImportTask: jest.fn(),
  uploadImportFile: jest.fn(),
  uploadImportFileMultipart: jest.fn(),
  CreateImportTaskType: { Notion: 'Notion' },
}));

const file = new File(['draft'], 'draft.zip');
const options = () => ({ taskType: CreateImportTaskType.Notion, onProgress: jest.fn() });
const task = { taskId: 'task', presignedUrl: 'upload', multipart: null };

beforeEach(() => {
  jest.resetAllMocks();
  mockScope = 'account-a:server-a';
  jest.mocked(createImportTask).mockResolvedValue(task);
  jest.mocked(cancelImportTask).mockResolvedValue(undefined);
  jest.mocked(uploadImportFile).mockResolvedValue(undefined);
});

test('admission denial preserves the caller file and starts neither upload nor task cleanup', async () => {
  jest.mocked(createImportTask).mockRejectedValue(new Error('Denied'));
  await expect(importFileWithUpload(file, options())).rejects.toThrow('Denied');
  expect(file.size).toBe(5);
  expect(uploadImportFile).not.toHaveBeenCalled();
  expect(cancelImportTask).not.toHaveBeenCalled();
});

test('a late task response from another context cannot start an upload or retarget cleanup', async () => {
  let resolve!: (value: typeof task) => void;

  jest.mocked(createImportTask).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = importFileWithUpload(file, options());

  mockScope = 'account-b:server-b';
  resolve(task);
  await expect(pending).rejects.toThrow('Context changed');
  expect(uploadImportFile).not.toHaveBeenCalled();
  expect(cancelImportTask).not.toHaveBeenCalled();
});

test('a failed upload cancels its task in the admitting context', async () => {
  jest.mocked(uploadImportFile).mockRejectedValue(new Error('Upload failed'));
  await expect(importFileWithUpload(file, options())).rejects.toThrow('Upload failed');
  expect(cancelImportTask).toHaveBeenCalledWith('task');
});

test.each([EventType.SESSION_INVALID, EventType.SESSION_VALID])(
  'account change aborts active upload on %s',
  async (event) => {
    let activeSignal: AbortSignal | undefined;
    let started!: () => void;
    const uploading = new Promise<void>((done) => {
      started = done;
    });

    jest.mocked(uploadImportFile).mockImplementation(async (_url, _file, _progress, signal) => {
      activeSignal = signal;
      started();
      await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted'))));
    });
    const pending = importFileWithUpload(file, options());

    await uploading;
    mockScope = 'account-b:server-a';
    emit(event);
    await expect(pending).rejects.toThrow('Aborted');
    expect(activeSignal?.aborted).toBe(true);
    expect(cancelImportTask).not.toHaveBeenCalled();
  }
);

test('the caller can cancel before task creation', async () => {
  const controller = new AbortController();

  controller.abort();
  await expect(importFileWithUpload(file, { ...options(), signal: controller.signal })).rejects.toThrow();
  expect(createImportTask).not.toHaveBeenCalled();
});

test('multipart completion has a final context guard even when no session event was delivered', async () => {
  const multipart = { s3_key: 'key', upload_id: 'id', part_presigned_urls: [] };

  jest.mocked(createImportTask).mockResolvedValue({ ...task, multipart });
  jest
    .mocked(uploadImportFileMultipart)
    .mockImplementation(async (_file, _multipart, _progress, _signal, beforeComplete) => {
      mockScope = 'account-a:server-b';
      beforeComplete?.();
    });
  await expect(importFileWithUpload(file, options())).rejects.toThrow('Context changed');
  expect(cancelImportTask).not.toHaveBeenCalled();
});

test('a token refresh for the same actor does not cancel an upload', async () => {
  jest.mocked(uploadImportFile).mockImplementation(async (_url, _file, progress, signal) => {
    emit(EventType.SESSION_REFRESH);
    progress(1);
    expect(signal?.aborted).toBe(false);
  });
  const settings = options();

  await importFileWithUpload(file, settings);
  expect(settings.onProgress).toHaveBeenCalledWith(1);
});
