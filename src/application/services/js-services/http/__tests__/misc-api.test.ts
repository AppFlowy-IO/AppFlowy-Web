import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

import { generateSearchSummary } from '../misc-api';

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
