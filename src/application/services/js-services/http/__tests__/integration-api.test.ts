import { IntegrationConnection } from '@/application/integrations/types';

import { executeAPIRequest, getAxios } from '../core';
import {
  listConnections,
  connectProvider,
  confirmConnection,
  disconnectConnection,
  getConnectionEmail,
} from '../integration-api';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: jest.fn(async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data),
}));

describe('integration API contract', () => {
  const get = jest.fn();
  const post = jest.fn();
  const remove = jest.fn();
  const signal = new AbortController().signal;
  const connection: IntegrationConnection = {
    id: 'connection',
    provider: 'google-drive',
    status: 'active',
    connected_at: '2026-09-19',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAxios).mockReturnValue({ get, post, delete: remove } as unknown as ReturnType<typeof getAxios>);
  });

  it('loads the current workspace connections and preserves account metadata', async () => {
    get.mockResolvedValue({ data: { data: { connections: [connection] } } });
    await expect(listConnections('workspace', signal)).resolves.toEqual([connection]);
    expect(get).toHaveBeenCalledWith(
      '/api/integrations/connections',
      expect.objectContaining({ params: { workspace_id: 'workspace', include_metadata: true }, signal })
    );
  });

  it('initiates and confirms with the original state binding and unmodified OAuth query', async () => {
    post.mockResolvedValueOnce({
      data: { data: { oauth_url: 'https://accounts.google.com', connection_id: 'pending-id' } },
    });
    await expect(connectProvider('workspace', 'google-calendar', signal)).resolves.toMatchObject({
      connection_id: 'pending-id',
    });
    expect(post).toHaveBeenLastCalledWith(
      '/api/integrations/connect/google-calendar',
      { workspace_id: 'workspace' },
      expect.objectContaining({ signal })
    );
    post.mockResolvedValueOnce({ data: { data: { success: true, connection } } });
    const query = 'code=code%2Bvalue&state=state&scope=calendar';

    await confirmConnection('workspace', 'google-calendar', 'pending-id', query, signal);
    expect(post).toHaveBeenLastCalledWith(
      '/api/integrations/connections/callback',
      { workspace_id: 'workspace', provider: 'google-calendar', connection_id: 'pending-id', oauth_query: query },
      expect.objectContaining({ signal })
    );
    expect(executeAPIRequest).toHaveBeenLastCalledWith(expect.any(Function), { suppressResponseDataLogging: true });
  });

  it('propagates a rejected disconnect instead of reporting success', async () => {
    remove.mockResolvedValue({ data: { data: { success: false } } });
    await expect(disconnectConnection('connection', signal)).resolves.toEqual({ success: false });
    expect(remove).toHaveBeenCalledWith('/api/integrations/connections/connection', expect.objectContaining({ signal }));
  });

  it.each([
    [
      'google-drive',
      '/drive/v3/about/?fields=user',
      { user: { emailAddress: 'drive@example.com' } },
      'drive@example.com',
    ],
    ['google-calendar', '/oauth2/v2/userinfo', { email: 'calendar@example.com' }, 'calendar@example.com'],
  ])('resolves %s email through the server proxy', async (provider, endpoint, data, email) => {
    post.mockResolvedValue({ data: { data: { data } } });
    await expect(getConnectionEmail('workspace', { ...connection, provider: provider as string }, signal)).resolves.toBe(
      email
    );
    expect(post).toHaveBeenCalledWith(
      '/api/integrations/proxy',
      { workspace_id: 'workspace', connection_id: 'connection', method: 'GET', endpoint },
      expect.objectContaining({ signal })
    );
  });
});
