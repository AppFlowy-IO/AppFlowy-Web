import { listFormSubmissions, patchFormShare, resetFormShare } from '../form-share-api';
import { executeAPIRequest, getAxios } from '../core';

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

  it('sends the lossless timestamp and submission-id cursor as one pair', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        data: { submissions: [] },
      },
    });

    mockGetAxios.mockReturnValue({ get } as never);
    const cursor = {
      submitted_at: '2026-08-28T12:34:56Z',
      submission_id: 'a0aa83b5-82f8-4eca-a466-954b7f329c78',
    };

    await expect(listFormSubmissions('workspace', 'database', 'view', { cursor, limit: 500 })).resolves.toEqual({
      submissions: [],
    });
    expect(get).toHaveBeenCalledWith('/api/workspace/workspace/database/database/view/view/form/submissions', {
      params: {
        before: cursor.submitted_at,
        before_id: cursor.submission_id,
        limit: 200,
      },
    });
    expect(executeAPIRequest).toHaveBeenLastCalledWith(expect.any(Function), {
      suppressResponseDataLogging: true,
    });
  });

  it('rejects a malformed half-equivalent cursor before issuing a request', async () => {
    const get = jest.fn();

    mockGetAxios.mockReturnValue({ get } as never);

    await expect(
      listFormSubmissions('workspace', 'database', 'view', {
        cursor: { submitted_at: 'not-a-date', submission_id: 'not-a-uuid' },
      })
    ).rejects.toMatchObject({ code: -1, message: 'Malformed form submission cursor.' });
    expect(get).not.toHaveBeenCalled();
  });
});
