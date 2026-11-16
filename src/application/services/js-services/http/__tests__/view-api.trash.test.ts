import { AxiosError, AxiosHeaders } from 'axios';

const mockGet = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet }),
  // As the real one: a response with a non-zero code rejects with that code.
  executeAPIRequest: async (request: () => Promise<{ data: { code: number; data?: unknown; message?: string } }>) => {
    const response = await request();

    if (response.data.code === 0) return response.data.data;
    throw { code: response.data.code, message: response.data.message };
  },
}));

import { getAppTrash, TRASH_READ_ATTEMPTS } from '../view-api';

const served = (views: unknown[]) => ({ data: { code: 0, data: { views } } });
// What Cloud answers a trash read that overlaps a permission change, as right after a move to the trash.
const retryLater = {
  data: { code: -5, message: 'trash visibility changed while loading; retry with current permissions' },
};

describe('getAppTrash', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGet.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends a read the server answers with RetryLater again until it is served', async () => {
    mockGet
      .mockResolvedValueOnce(retryLater)
      .mockResolvedValueOnce(retryLater)
      .mockResolvedValueOnce(served([{ view_id: 'chart' }]));

    const views = getAppTrash('workspace-1');

    await jest.advanceTimersByTimeAsync(100 + 200);
    await expect(views).resolves.toEqual([{ view_id: 'chart' }]);
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(mockGet).toHaveBeenCalledWith('/api/workspace/workspace-1/trash');
  });

  it('retries a RetryLater carried by an HTTP error response too', async () => {
    const busy = new AxiosError('Service busy', 'ERR_BAD_RESPONSE', undefined, undefined, {
      data: { code: -5, message: 'busy' },
      status: 503,
      statusText: 'Service Unavailable',
      headers: {},
      config: { headers: new AxiosHeaders() },
    });

    mockGet.mockRejectedValueOnce(busy).mockResolvedValueOnce(served([]));

    const views = getAppTrash('workspace-1');

    await jest.advanceTimersByTimeAsync(100);
    await expect(views).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('returns any other failure at once', async () => {
    mockGet.mockResolvedValueOnce({ data: { code: 1012, message: 'not allowed' } });

    await expect(getAppTrash('workspace-1')).rejects.toMatchObject({ code: 1012 });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns a transport failure at once', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(getAppTrash('workspace-1')).rejects.toThrow('Network Error');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it(`gives up after ${TRASH_READ_ATTEMPTS} RetryLater answers, about 3 s in all`, async () => {
    mockGet.mockResolvedValue(retryLater);

    const settled = expect(getAppTrash('workspace-1')).rejects.toMatchObject({ code: -5 });

    await jest.advanceTimersByTimeAsync(100 + 200 + 400 + 800 + 1_600);
    await settled;
    expect(mockGet).toHaveBeenCalledTimes(TRASH_READ_ATTEMPTS);
  });
});
