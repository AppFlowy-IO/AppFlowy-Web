import { getAxios } from '../core';
import { reportSearchPresentationMetrics } from '../search-presentation-metrics';

jest.mock('../core', () => ({ getAxios: jest.fn() }));

const sample = {
  transport: 'stream',
  mode: 'hybrid',
  outcome: 'complete',
  elapsed_ms: 900,
  all_results_received_ms: 800,
} as const;

beforeEach(() => jest.clearAllMocks());

it('sends only the bounded timing sample, with an independent short single-attempt request', async () => {
  const post = jest.fn().mockResolvedValue({ status: 204 });

  jest.mocked(getAxios).mockReturnValue({ post } as never);
  await reportSearchPresentationMetrics('workspace-id', sample);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/api/search/workspace-id/stream/metrics', sample, {
    timeout: 3_000,
    skipTransportRetry: true,
    skipAuthRefresh: true,
  });
  expect(post.mock.calls[0][2]).not.toHaveProperty('signal');
});

it('ignores failures or an unavailable API client without surfacing a user error', async () => {
  const post = jest.fn().mockRejectedValue(new Error('unavailable'));

  jest.mocked(getAxios).mockReturnValue({ post } as never);
  await expect(reportSearchPresentationMetrics('workspace-id', sample)).resolves.toBeUndefined();
  expect(post).toHaveBeenCalledTimes(1);
  jest.mocked(getAxios).mockReturnValue(undefined as never);
  await expect(reportSearchPresentationMetrics('workspace-id', sample)).resolves.toBeUndefined();
});
