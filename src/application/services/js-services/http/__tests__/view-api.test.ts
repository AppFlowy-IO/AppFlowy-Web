const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet, post: mockPost }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();

    return response.data.data;
  },
}));

import { getView, getViews, listWorkspaceDatabases } from '../view-api';

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
    // The next offset advances by the number of items actually returned, not by
    // the requested limit, so a server that caps pages below the limit cannot
    // cause records to be skipped.
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/workspace/workspace-1/database', {
      params: { offset: 1, limit: 200 },
    });
  });

  it('stops when the server returns an empty page even if has_more is set', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: {
          databases: [],
          has_more: true,
        },
      },
    });

    await expect(listWorkspaceDatabases('workspace-1')).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});


describe('view HTTP cancellation', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  function response(views: unknown[]) {
    return { data: { data: { views } } };
  }

  it('forwards cancellation to an individual view read', async () => {
    const controller = new AbortController();
    const canceled = new Error('canceled');

    mockGet.mockImplementation((_url: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(canceled), { once: true });
    }));
    const pending = getView('workspace', 'view', 3, controller.signal);
    const rejection = expect(pending).rejects.toBe(canceled);

    expect(mockGet).toHaveBeenCalledWith('/api/workspace/workspace/view/view?depth=3', { signal: controller.signal });
    controller.abort();
    await rejection;
  });

  it('forwards one signal to every GET chunk and preserves result order', async () => {
    const controller = new AbortController();
    const ids = Array.from({ length: 101 }, (_, index) => `view-${index}`);

    mockGet.mockImplementation((url: string) => Promise.resolve(response(
      new URL(url, 'https://server.test').searchParams.get('view_ids')?.split(',').map((view_id) => ({ view_id })) ?? []
    )));
    await expect(getViews('workspace', ids, 2, controller.signal)).resolves.toEqual(ids.map((view_id) => ({ view_id })));
    expect(mockGet).toHaveBeenCalledTimes(3);
    for (const [, config] of mockGet.mock.calls) expect(config.signal).toBe(controller.signal);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('forwards one signal to every POST chunk when GET URLs would be oversized', async () => {
    const controller = new AbortController();
    const ids = Array.from({ length: 100 }, (_, index) => `${index}-${'a'.repeat(100)}`);

    mockPost.mockImplementation((_url: string, { view_ids }: { view_ids: string[] }) =>
      Promise.resolve(response(view_ids.map((view_id) => ({ view_id })) ))
    );
    await expect(getViews('workspace', ids, 2, controller.signal)).resolves.toEqual(ids.map((view_id) => ({ view_id })));
    expect(mockPost).toHaveBeenCalledTimes(2);
    for (const [, , config] of mockPost.mock.calls) expect(config.signal).toBe(controller.signal);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each([404, 405])('keeps cancellation on every GET fallback after POST status %s', async (code) => {
    const controller = new AbortController();
    const ids = Array.from({ length: 100 }, (_, index) => `${index}-${'a'.repeat(100)}`);

    mockPost.mockRejectedValue({ code });
    mockGet.mockImplementation((url: string) => Promise.resolve(response(
      new URL(url, 'https://server.test').searchParams.get('view_ids')?.split(',').map((view_id) => ({ view_id })) ?? []
    )));
    await expect(getViews('workspace', ids, 2, controller.signal)).resolves.toEqual(ids.map((view_id) => ({ view_id })));
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls.length).toBeGreaterThan(2);
    for (const [, , config] of mockPost.mock.calls) expect(config.signal).toBe(controller.signal);
    for (const [, config] of mockGet.mock.calls) expect(config.signal).toBe(controller.signal);
  });

  it('aborted POST chunks do not fall back to new GET requests', async () => {
    const controller = new AbortController();
    const canceled = { code: 'ERR_CANCELED' };
    const ids = Array.from({ length: 100 }, (_, index) => `${index}-${'a'.repeat(100)}`);
    let canceledChunks = 0;

    mockPost.mockImplementation((_url: string, _body: unknown, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        canceledChunks++;
        reject(canceled);
      }, { once: true }))
    );
    const pending = getViews('workspace', ids, 2, controller.signal);
    const rejection = expect(pending).rejects.toBe(canceled);

    expect(mockPost).toHaveBeenCalledTimes(2);
    controller.abort();
    await rejection;
    expect(canceledChunks).toBe(2);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
