import { realtimeSessionKey } from '../realtime-session';

let mockServer = 'https://one.example';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));

function select(userId: string, accessToken = 'access') {
  localStorage.setItem('token', JSON.stringify({ access_token: accessToken, refresh_token: 'refresh',
    expires_at: 100, user: { id: userId } }));
}

afterEach(() => localStorage.clear());

it('partitions coordination by server, actor and workspace, while preserving token refresh', () => {
  select('actor-a');
  const original = realtimeSessionKey('workspace');

  select('actor-a', 'refreshed');
  expect(realtimeSessionKey('workspace')).toBe(original);
  expect(realtimeSessionKey('other-workspace')).not.toBe(original);
  select('actor-b');
  expect(realtimeSessionKey('workspace')).not.toBe(original);
  select('actor-a');
  mockServer = 'https://two.example';
  expect(realtimeSessionKey('workspace')).not.toBe(original);
});
