import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import { generateSearchSummary, searchWorkspaceDocumentPage } from '../misc-api';

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
}));

describe('generateSearchSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses default auto_if_empty retrieval without sending client search results', async () => {
    const post = jest.fn();

    jest.mocked(getAxios).mockReturnValue({ post } as never);

    await generateSearchSummary('workspace-id', 'show my tasks');

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();

    expect(post).toHaveBeenCalledWith(
      '/api/search/workspace-id/summary',
      {
        query: 'show my tasks',
        only_context: true,
      },
      {
        headers: {
          'x-request-time': expect.any(String),
        },
      }
    );
    const payload = post.mock.calls[0][1];

    expect(payload).not.toHaveProperty('search_results');
    expect(payload).not.toHaveProperty('object_ids');
    expect(payload).not.toHaveProperty('retrieval_mode');
  });
});

describe('searchWorkspaceDocumentPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the caller stream id so keyword and summary retrieval stay isolated', async () => {
    const get = jest.fn();

    jest.mocked(getAxios).mockReturnValue({ get } as never);

    await searchWorkspaceDocumentPage('workspace-id', 'show my tasks', 0, 'keyword-stream-id');

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();

    expect(get).toHaveBeenCalledWith(
      '/api/search/workspace-id/page',
      expect.objectContaining({
        headers: {
          'x-request-time': expect.any(String),
          'x-request-stream-id': 'keyword-stream-id',
        },
      })
    );
  });
});


describe('search HTTP cancellation', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['keyword', 'summary'] as const)('forwards the caller signal to %s transport', async (kind) => {
    const controller = new AbortController();
    const canceled = new Error('canceled');
    const transport = jest.fn((_url: string, configOrPayload: unknown, postConfig?: { signal?: AbortSignal }) => {
      const config = postConfig ?? configOrPayload as { signal?: AbortSignal };

      return new Promise((_resolve, reject) => {
        config.signal?.addEventListener('abort', () => reject(canceled), { once: true });
      });
    });

    jest.mocked(getAxios).mockReturnValue({ get: transport, post: transport } as never);
    if (kind === 'keyword') {
      await searchWorkspaceDocumentPage('workspace-id', 'private notes', 20, 'keyword-stream', controller.signal);
    } else {
      await generateSearchSummary('workspace-id', 'private notes', controller.signal);
    }

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];
    const pending = request();
    const rejection = expect(pending).rejects.toBe(canceled);
    const config = kind === 'keyword' ? transport.mock.calls[0][1] : transport.mock.calls[0][2];

    expect(config).toEqual(expect.objectContaining({ signal: controller.signal }));
    controller.abort();
    await rejection;
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
