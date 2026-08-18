const mockGet = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();

    return response.data.data;
  },
}));

import { listWorkspaceDatabases } from '../view-api';

describe('workspace database list HTTP API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opts into the metadata response and loads every page', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          data: {
            databases: [{ database_id: 'database-1', views: [] }],
            has_more: true,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            databases: [{ database_id: 'database-2', views: [] }],
            has_more: false,
          },
        },
      });

    await expect(listWorkspaceDatabases('workspace-1')).resolves.toEqual([
      { database_id: 'database-1', views: [] },
      { database_id: 'database-2', views: [] },
    ]);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/api/workspace/workspace-1/database', {
      params: { offset: 0, limit: 200 },
    });
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-1/database', {
      params: { offset: 200, limit: 200 },
    });
  });
});
