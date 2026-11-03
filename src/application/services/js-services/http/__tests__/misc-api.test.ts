import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import {
  generateSearchSummary,
  generateSearchSummaryForDocuments,
  searchWorkspaceDocumentPage,
} from '../misc-api';

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

  it('forwards the caller abort signal without changing the legacy summary payload', async () => {
    const post = jest.fn();
    const controller = new AbortController();

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    await generateSearchSummary('workspace-id', 'show my tasks', controller.signal);

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();
    expect(post).toHaveBeenCalledWith(
      '/api/search/workspace-id/summary',
      { query: 'show my tasks', only_context: true },
      {
        headers: { 'x-request-time': expect.any(String) },
        signal: controller.signal,
      }
    );
  });
});

describe('generateSearchSummaryForDocuments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses unique completed result identities and suppresses transport retries', async () => {
    const post = jest.fn();
    const controller = new AbortController();

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    await generateSearchSummaryForDocuments(
      'workspace-id',
      'show my tasks',
      ['document-a', 'document-b', 'document-a'],
      controller.signal
    );

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/api/search/workspace-id/summary',
      {
        query: 'show my tasks',
        object_ids: ['document-a', 'document-b'],
        only_context: true,
        retrieval_mode: 'provided_only',
      },
      {
        headers: { 'x-request-time': expect.any(String) },
        signal: controller.signal,
        skipTransportRetry: true,
      }
    );
  });

  it('keeps an empty result set explicit instead of enabling automatic retrieval', async () => {
    const post = jest.fn();

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    await generateSearchSummaryForDocuments('workspace-id', 'show my tasks', []);

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();
    expect(post).toHaveBeenCalledWith(
      '/api/search/workspace-id/summary',
      { query: 'show my tasks', object_ids: [], only_context: true, retrieval_mode: 'provided_only' },
      {
        headers: { 'x-request-time': expect.any(String) },
        skipTransportRetry: true,
      }
    );
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
      {
        params: {
          query: 'show my tasks',
          limit: 10,
          offset: 0,
          preview_size: 80,
          mode: 'keyword',
          score: 0.2,
        },
        headers: {
          'x-request-time': expect.any(String),
          'x-request-stream-id': 'keyword-stream-id',
        },
      }
    );
  });

  it('forwards cancellation while keeping the requested keyword page and stream identity', async () => {
    const get = jest.fn();
    const controller = new AbortController();

    jest.mocked(getAxios).mockReturnValue({ get } as never);
    await searchWorkspaceDocumentPage('workspace-id', 'show my tasks', 20, 'keyword-stream-id', controller.signal);

    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();
    expect(get).toHaveBeenCalledWith(
      '/api/search/workspace-id/page',
      {
        params: {
          query: 'show my tasks',
          limit: 10,
          offset: 20,
          preview_size: 80,
          mode: 'keyword',
          score: 0.2,
        },
        headers: {
          'x-request-time': expect.any(String),
          'x-request-stream-id': 'keyword-stream-id',
        },
        signal: controller.signal,
      }
    );
  });
});
