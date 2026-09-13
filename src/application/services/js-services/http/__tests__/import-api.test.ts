import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import {
  createConfluenceImportTask,
  createImportTask,
  CreateImportTaskType,
  createNotionImportTask,
} from '../import-api';

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
}));

describe('createImportTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['AppFlowy workspace', CreateImportTaskType.Workspace],
    ['Notion workspace', CreateImportTaskType.Notion],
    ['Confluence space', CreateImportTaskType.Confluence],
  ])('sends the selected task type for an %s import', async (_label, taskType) => {
    const post = jest.fn();

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    jest.mocked(executeAPIRequest).mockImplementation(async (request) => {
      await request();
      return {
        task_id: 'task-id',
        presigned_url: 'https://example.com/upload',
        multipart: null,
      };
    });

    const file = new File(['workspace'], 'My Workspace.zip', { type: 'application/zip' });

    await createImportTask(file, taskType);

    expect(post).toHaveBeenCalledWith(
      '/api/import/create',
      {
        workspace_name: 'My Workspace',
        content_length: file.size,
        task_type: taskType,
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Host': expect.any(String),
        }),
      })
    );
  });
});

describe.each([
  ['notion', createNotionImportTask],
  ['confluence', createConfluenceImportTask],
] as const)('create %s page import task', (source, createTask) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([false, true])('preserves the destination and upload response (multipart=%s)', async (isMultipart) => {
    const post = jest.fn();
    const multipart = isMultipart
      ? {
          s3_key: 'workspace/task.zip',
          upload_id: 'upload-id',
          part_presigned_urls: [{ part_number: 1, presigned_url: 'https://example.com/part-1' }],
        }
      : undefined;

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    jest.mocked(executeAPIRequest).mockImplementation(async (request) => {
      await request();
      return { task_id: 'task-id', presigned_url: 'https://example.com/upload', multipart };
    });

    const payload = { content_length: 4096, md5_base64: 'checksum' };

    await expect(createTask('workspace/id', 'parent-page-id', payload)).resolves.toEqual({
      taskId: 'task-id',
      presignedUrl: 'https://example.com/upload',
      multipart: multipart ?? null,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`/api/import/workspace%2Fid/${source}`, payload, {
      params: { page_id: 'parent-page-id' },
      headers: { 'X-Host': expect.any(String) },
    });
  });
});
