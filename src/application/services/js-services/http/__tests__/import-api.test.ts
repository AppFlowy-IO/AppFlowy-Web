import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import { createImportTask, CreateImportTaskType } from '../import-api';

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
