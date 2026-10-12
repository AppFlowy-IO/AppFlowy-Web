import { getGroupSpaceCoverage, setGroupSpaceCoverage } from '../group-space-coverage-api';

const groupId = '12345678-1234-4123-8123-123456789abc';
const mockClient = { get: jest.fn(), put: jest.fn() };
let mockActor = 'owner';
let mockServer = 'server';

jest.mock('../core', () => ({
  getAxios: () => mockClient,
  executeAPIRequest: async (request: () => Promise<{ data: unknown }>) => (await request()).data,
}));
jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockActor } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServer }));
jest.mock('i18next', () => ({ t: (key: string) => key }));

beforeEach(() => {
  jest.clearAllMocks();
  mockActor = 'owner';
  mockServer = 'server';
  mockClient.get.mockResolvedValue({ data: { access_level: null } });
  mockClient.put.mockImplementation(async (_url, payload) => ({ data: payload }));
});

test.each([null, 10, 30] as const)('fresh Owner read precedes explicit access_level=%s PUT', async (level) => {
  expect(await setGroupSpaceCoverage('workspace', groupId, level)).toEqual({ access_level: level });
  const url = `/api/workspace/workspace/groups/${groupId}/space-coverage`;

  expect(mockClient.get).toHaveBeenCalledWith(url);
  expect(mockClient.put).toHaveBeenCalledWith(url, { access_level: level });
  expect(mockClient.get.mock.invocationCallOrder[0]).toBeLessThan(mockClient.put.mock.invocationCallOrder[0]);
});

test.each([undefined, 20, 50, '10'])(
  'rejects unsupported or omitted access level %s without a request',
  async (level) => {
    await expect(setGroupSpaceCoverage('workspace', groupId, level as never)).rejects.toThrow();
    expect(mockClient.get).not.toHaveBeenCalled();
    expect(mockClient.put).not.toHaveBeenCalled();
  }
);

test.each([{}, { access_level: 20 }, { access_level: '30' }])(
  'does not manufacture Off from malformed current state %p',
  async (data) => {
    mockClient.get.mockResolvedValue({ data });
    await expect(setGroupSpaceCoverage('workspace', groupId, 30)).rejects.toThrow('groupSpaceAccess.invalidResponse');
    expect(mockClient.put).not.toHaveBeenCalled();
  }
);

test('a fresh Owner denial prevents PUT and is never retried on a legacy endpoint', async () => {
  mockClient.get.mockRejectedValue({ code: 403 });
  await expect(setGroupSpaceCoverage('workspace', groupId, 30)).rejects.toEqual({ code: 403 });
  expect(mockClient.put).not.toHaveBeenCalled();
  expect(mockClient.get).toHaveBeenCalledTimes(1);
});

test.each(['account', 'server', 'revision'])('fences a pending Owner read after %s change', async (change) => {
  let resolve!: (value: unknown) => void;
  let current = true;

  mockClient.get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = setGroupSpaceCoverage('workspace', groupId, 10, () => current);

  if (change === 'account') mockActor = 'different';
  if (change === 'server') mockServer = 'different';
  if (change === 'revision') current = false;
  resolve({ data: { access_level: null } });
  await expect(pending).rejects.toThrow();
  expect(mockClient.put).not.toHaveBeenCalled();
});

test('success must confirm the requested selection', async () => {
  mockClient.put.mockResolvedValue({ data: { access_level: null } });
  await expect(setGroupSpaceCoverage('workspace', groupId, 30)).rejects.toThrow('groupSpaceAccess.invalidResponse');
});

test('an invalid principal never enters the request path', async () => {
  await expect(getGroupSpaceCoverage('workspace', 'group/other')).rejects.toThrow();
  expect(mockClient.get).not.toHaveBeenCalled();
});
