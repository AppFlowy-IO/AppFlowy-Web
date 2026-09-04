import { patchFormShare, resetFormShare } from '../form-share-api';
import { getAxios } from '../core';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: jest.fn(async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();

    return response.data.data;
  }),
  executeAPIVoidRequest: jest.fn(async (request: () => Promise<unknown>) => {
    await request();
  }),
}));

describe('form share API contract', () => {
  const mockGetAxios = getAxios as jest.MockedFunction<typeof getAxios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves PATCH null semantics when clearing expiry', async () => {
    const patch = jest.fn().mockResolvedValue({
      data: {
        data: null,
      },
    });

    mockGetAxios.mockReturnValue({ patch } as never);

    await expect(patchFormShare('workspace', 'database', 'view', { expires_at: null })).resolves.toBeNull();
    expect(patch).toHaveBeenCalledWith('/api/workspace/workspace/database/database/view/view/form/share', {
      expires_at: null,
    });
  });

  it('sends a sparse reset so the server preserves settings atomically', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        data: { token: 'rotated' },
      },
    });

    mockGetAxios.mockReturnValue({ post } as never);

    await expect(resetFormShare('workspace', 'database', 'view')).resolves.toEqual({ token: 'rotated' });
    expect(post).toHaveBeenCalledWith('/api/workspace/workspace/database/database/view/view/form/share/reset', {});
  });
});
