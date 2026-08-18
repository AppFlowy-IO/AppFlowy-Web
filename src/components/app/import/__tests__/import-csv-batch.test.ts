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
  cancelDatabaseCsvImportTask,
  createDatabaseCsvImportTask,
  getDatabaseCsvImportStatus,
  uploadDatabaseCsvImportFile,
} from '@/application/services/js-services/http/import-api';
import { importCsvFilesAsDatabases } from '@/components/app/import/import-service';

const createTask = createDatabaseCsvImportTask as jest.Mock;
const uploadFile = uploadDatabaseCsvImportFile as jest.Mock;
const getStatus = getDatabaseCsvImportStatus as jest.Mock;
const cancelTask = cancelDatabaseCsvImportTask as jest.Mock;

const WORKSPACE_ID = 'workspace-1';
const PARENT_VIEW_ID = 'parent-view-1';

function csvFile(name: string): File {
  return new File(['name,age\nada,36'], name, { type: 'text/csv' });
}

/** Every task completes on its first status poll, so the batch never sleeps. */
function stubHappyPath() {
  createTask.mockImplementation((_workspaceId: string, payload: { name: string }) =>
    Promise.resolve({
      task_id: `task-${payload.name}`,
      presigned_url: `https://s3.test/${payload.name}`,
      expires_in_secs: 1800,
    })
  );
  uploadFile.mockResolvedValue(undefined);
  cancelTask.mockResolvedValue(undefined);
  getStatus.mockImplementation((_workspaceId: string, taskId: string) =>
    Promise.resolve({
      task_id: taskId,
      status: 'Completed',
      progress: { rows_processed: 1, rows_total: 1 },
      view_id: `view-${taskId}`,
    })
  );
}

describe('importCsvFilesAsDatabases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports every selected file as its own grid, in selection order', async () => {
    stubHappyPath();

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv'), csvFile('three.csv')],
    });

    expect(result.aborted).toBe(false);
    expect(result.items).toEqual([
      { fileName: 'one.csv', viewId: 'view-task-one' },
      { fileName: 'two.csv', viewId: 'view-task-two' },
      { fileName: 'three.csv', viewId: 'view-task-three' },
    ]);
    expect(createTask.mock.calls.map(([, payload]) => payload.name)).toEqual(['one', 'two', 'three']);
    expect(createTask.mock.calls.every(([, payload]) => payload.parent_view_id === PARENT_VIEW_ID)).toBe(true);
  });

  it('runs one file at a time so the server pending-task cap is not tripped', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    stubHappyPath();
    uploadFile.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv'), csvFile('three.csv')],
    });

    expect(maxInFlight).toBe(1);
  });

  it('reports progress before each file starts', async () => {
    stubHappyPath();
    const starts: Array<[number, number]> = [];

    await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv')],
      onFileStart: (index, total) => starts.push([index, total]),
    });

    expect(starts).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('keeps importing after a file fails and records its error', async () => {
    stubHappyPath();
    const okTask = createTask.getMockImplementation() as (workspaceId: string, payload: { name: string }) => unknown;

    createTask.mockImplementation((workspaceId: string, payload: { name: string }) => {
      // Mirrors the HTTP layer, which rejects with { code, message } rather than an Error.
      if (payload.name === 'two') return Promise.reject({ code: -1, message: 'file too large' });
      return okTask(workspaceId, payload);
    });

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv'), csvFile('three.csv')],
    });

    expect(result.aborted).toBe(false);
    expect(result.items).toEqual([
      { fileName: 'one.csv', viewId: 'view-task-one' },
      { fileName: 'two.csv', error: 'file too large' },
      { fileName: 'three.csv', viewId: 'view-task-three' },
    ]);
  });

  it('surfaces a server-side import failure without stopping the batch', async () => {
    stubHappyPath();
    getStatus.mockImplementation((_workspaceId: string, taskId: string) =>
      Promise.resolve(
        taskId === 'task-two'
          ? { task_id: taskId, status: 'Failed', progress: { rows_processed: 0, rows_total: 0 }, error: 'bad header' }
          : {
              task_id: taskId,
              status: 'Completed',
              progress: { rows_processed: 1, rows_total: 1 },
              view_id: `view-${taskId}`,
            }
      )
    );

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv')],
    });

    expect(result.items).toEqual([
      { fileName: 'one.csv', viewId: 'view-task-one' },
      { fileName: 'two.csv', error: 'bad header' },
    ]);
    expect(cancelTask).toHaveBeenCalledWith(WORKSPACE_ID, 'task-two');
  });

  it('leaves the message empty when the rejection carries none, so the caller can translate', async () => {
    stubHappyPath();
    createTask.mockRejectedValue({ code: -1 });

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv')],
    });

    // Never an English string baked in here — `ImportDialog` supplies the translated wording.
    expect(result.items).toEqual([{ fileName: 'one.csv', error: '' }]);
  });

  it('hands the signal to the upload and treats a cancelled upload as an abort', async () => {
    stubHappyPath();
    const controller = new AbortController();

    uploadFile.mockImplementation(async () => {
      controller.abort();
      // axios rejects an aborted request with a CanceledError, not an ImportAbortError.
      throw Object.assign(new Error('canceled'), { name: 'CanceledError' });
    });

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv')],
      signal: controller.signal,
    });

    expect(uploadFile).toHaveBeenCalledWith(expect.any(String), expect.anything(), undefined, controller.signal);
    // Cancelling must not be reported as "one.csv failed", and must stop the batch.
    expect(result).toEqual({ items: [], aborted: true });
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('stops at the current file when aborted and returns what already imported', async () => {
    stubHappyPath();
    const controller = new AbortController();

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv'), csvFile('two.csv'), csvFile('three.csv')],
      signal: controller.signal,
      onFileStart: (index) => {
        if (index === 1) controller.abort();
      },
    });

    expect(result.aborted).toBe(true);
    expect(result.items).toEqual([{ fileName: 'one.csv', viewId: 'view-task-one' }]);
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('does not start anything when the signal is already aborted', async () => {
    stubHappyPath();
    const controller = new AbortController();

    controller.abort();

    const result = await importCsvFilesAsDatabases({
      workspaceId: WORKSPACE_ID,
      parentViewId: PARENT_VIEW_ID,
      files: [csvFile('one.csv')],
      signal: controller.signal,
    });

    expect(result).toEqual({ items: [], aborted: true });
    expect(createTask).not.toHaveBeenCalled();
  });
});
