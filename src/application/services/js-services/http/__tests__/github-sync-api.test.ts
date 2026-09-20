import { executeAPIRequest, getAxios } from '../core';
import {
  createBinding,
  getBinding,
  getConfiguration,
  getPageSource,
  probeRepository,
  updateBinding,
} from '../github-sync-api';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: jest.fn(async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data),
}));

describe('GitHub synchronization API', () => {
  const get = jest.fn();
  const post = jest.fn();
  const patch = jest.fn();
  const signal = new AbortController().signal;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAxios).mockReturnValue({ get, post, patch } as unknown as ReturnType<typeof getAxios>);
  });

  it('uses the authenticated Cloud probe without requiring OAuth for a public repository', async () => {
    post.mockResolvedValue({ data: { data: { status: 'ready', repository: { id: 12, private: false } } } });
    await expect(probeRepository('workspace', {}, signal)).resolves.toMatchObject({ status: 'ready' });
    expect(post).toHaveBeenCalledWith(
      '/api/integrations/github/workspaces/workspace/repository',
      {},
      expect.objectContaining({ signal, timeout: expect.any(Number) })
    );
    expect(executeAPIRequest).toHaveBeenLastCalledWith(expect.any(Function), { suppressResponseDataLogging: true });
  });

  it('creates a public binding without a synthetic account or credentials', async () => {
    const input = { repository_id: 12, space_id: 'space', branch: 'main', root_path: 'docs' };

    post.mockResolvedValue({ data: { data: { binding: { id: 'binding' }, run: { id: 'run', status: 'pending' } } } });
    await expect(createBinding('workspace', input, signal)).resolves.toMatchObject({ run: { status: 'pending' } });
    expect(post.mock.calls[0][1]).toEqual(input);
    expect(post.mock.calls[0][1]).not.toHaveProperty('connection_id');
  });

  it('passes an explicitly selected private account and generation to Cloud', async () => {
    post.mockResolvedValue({ data: { data: { status: 'authentication_required' } } });
    await expect(probeRepository('workspace', { connection_id: 'account' }, signal)).resolves.toEqual({
      status: 'authentication_required',
    });
    expect(post.mock.calls[0][1]).toEqual({ connection_id: 'account' });
    patch.mockResolvedValue({ data: { data: { binding: { generation: 7 } } } });
    await updateBinding('workspace', 'binding', { expected_generation: 7, connection_id: 'account' }, signal);
    expect(patch).toHaveBeenCalledWith(
      '/api/integrations/github/workspaces/workspace/bindings/binding',
      { expected_generation: 7, connection_id: 'account' },
      expect.objectContaining({ signal })
    );
  });

  it('uses an explicit public transition instead of a null credential for reconnect', async () => {
    patch.mockResolvedValue({ data: { data: { binding: { authentication_mode: 'public' } } } });
    await updateBinding('workspace', 'binding', { expected_generation: 4, authentication_mode: 'public' }, signal);
    expect(patch.mock.calls[0][1]).toEqual({ expected_generation: 4, authentication_mode: 'public' });
  });

  it('preserves provider rate-limit failures rather than converting them into an OAuth prompt', async () => {
    const failure = { code: 1027, message: 'github_rate_limited', retryAfterSecs: 60 };

    post.mockRejectedValue(failure);
    await expect(probeRepository('workspace', {}, signal)).rejects.toBe(failure);
  });

  it('keeps workspace and object paths isolated, and preserves an unmanaged-page result', async () => {
    get.mockResolvedValue({ data: { data: null } });
    await expect(getPageSource('workspace/other', 'page?query', signal)).resolves.toBeNull();
    expect(get).toHaveBeenLastCalledWith(
      '/api/integrations/github/workspaces/workspace%2Fother/pages/page%3Fquery/source',
      expect.objectContaining({ signal })
    );
    await getBinding('workspace', 'binding/other', signal);
    expect(get.mock.calls[1][0]).toBe('/api/integrations/github/workspaces/workspace/bindings/binding%2Fother');
  });

  it('reads public sync availability independently of configured OAuth providers', async () => {
    get.mockResolvedValue({ data: { data: { available: true, oauth_configured: false } } });
    await expect(getConfiguration('workspace', signal)).resolves.toEqual({ available: true, oauth_configured: false });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/api/integrations/github/workspaces/workspace/configuration');
  });
});
