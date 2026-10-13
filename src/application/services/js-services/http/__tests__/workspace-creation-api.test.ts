import { createImportTask, CreateImportTaskType, createConfluenceImportTask } from '../import-api';
import { createWorkspace } from '../workspace-api';
import { ensureCanCreateWorkspace, getWorkspaceCreationCapability } from '../workspace-creation-api';

const mockClient = { get: jest.fn(), post: jest.fn() };
let mockUserId = 'user';
let mockServerUrl = 'https://server';

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServerUrl }));
jest.mock('../core', () => ({
  getAxios: () => mockClient,
  executeAPIRequest: async (request: () => Promise<{ data: unknown }>) => (await request()).data,
  executeAPIVoidRequest: async (request: () => Promise<unknown>) => {
    await request();
  },
}));
jest.mock('i18next', () => ({ t: (key: string) => key }));

const allowed = { supported: true, mode: 'selected_users', revision: '9007199254740993', can_create_workspace: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user';
  mockServerUrl = 'https://server';
  mockClient.get.mockResolvedValue({ data: allowed });
  mockClient.post.mockResolvedValue({
    data: { workspace_id: 'new-workspace', task_id: 'task', presigned_url: 'upload' },
  });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

test.each([allowed, { ...allowed, supported: false, mode: 'unrestricted', can_create_workspace: true }])(
  'uses the explicit authenticated capability including hosted supported=false semantics',
  async (capability) => {
    mockClient.get.mockResolvedValue({ data: capability });
    expect(await getWorkspaceCreationCapability()).toEqual(capability);
    expect(mockClient.get).toHaveBeenCalledWith('/api/user/workspace-creation-capability');
  }
);

test.each([
  { ...allowed, mode: 'future' },
  { ...allowed, revision: Number('9007199254740993') },
  { ...allowed, revision: '-1' },
  { ...allowed, can_create_workspace: undefined },
])('rejects a malformed capability', async (capability) => {
  mockClient.get.mockResolvedValue({ data: capability });
  await expect(getWorkspaceCreationCapability()).rejects.toThrow('workspaceCreation.invalidResponse');
});

test('both workspace and new-workspace import POSTs require a fresh current grant', async () => {
  mockClient.get.mockResolvedValue({ data: { ...allowed, can_create_workspace: false } });
  await expect(createWorkspace({ workspace_name: 'draft' })).rejects.toThrow('workspaceCreation.denied');
  await expect(createImportTask(new File(['draft'], 'draft.zip'), CreateImportTaskType.Notion)).rejects.toThrow(
    'workspaceCreation.denied'
  );
  expect(mockClient.post).not.toHaveBeenCalled();
  expect(mockClient.get).toHaveBeenCalledTimes(2);
});

test('existing-workspace import uses its own destination permissions', async () => {
  await createConfluenceImportTask('workspace', 'parent', { content_length: 10, md5_base64: 'checksum' });
  expect(mockClient.get).not.toHaveBeenCalled();
  expect(mockClient.post).toHaveBeenCalled();
});

test.each([404, 405])('a server without the capability route (%s) is a legacy server, not a denial', async (status) => {
  mockClient.get.mockRejectedValue({ code: status, httpStatus: status });
  expect(await getWorkspaceCreationCapability()).toEqual({
    supported: false,
    mode: 'unrestricted',
    revision: '0',
    can_create_workspace: true,
    legacy: true,
  });
});

test('an application error that uses HTTP 404 is not mistaken for a legacy server', async () => {
  mockClient.get.mockRejectedValue({ code: -2, httpStatus: 404, message: 'missing' });
  await expect(getWorkspaceCreationCapability()).rejects.toMatchObject({ code: -2 });
});

test('a server response cannot claim the client-only legacy marker', async () => {
  mockClient.get.mockResolvedValue({ data: { ...allowed, can_create_workspace: false, legacy: true } });
  expect(await getWorkspaceCreationCapability()).toEqual({ ...allowed, can_create_workspace: false });
});

test('a legacy server keeps new-workspace import available and lets the server decide', async () => {
  mockClient.get.mockRejectedValue({ code: 404, httpStatus: 404 });
  await createImportTask(new File(['draft'], 'draft.zip'), CreateImportTaskType.Notion);
  expect(mockClient.post.mock.calls[0][0]).toBe('/api/import/create');
});

test('a legacy server creates through its original route without a request ID', async () => {
  const reserve = jest.fn(() => 'unused');

  mockClient.get.mockRejectedValue({ code: 404, httpStatus: 404 });
  expect(await createWorkspace({ workspace_name: 'Legacy' }, { reserve })).toBe('new-workspace');
  expect(reserve).not.toHaveBeenCalled();
  expect(mockClient.post).toHaveBeenCalledWith('/api/workspace', { workspace_name: 'Legacy' });
});

test('a late positive cannot authorize another account or API origin', async () => {
  let resolve!: (value: { data: typeof allowed }) => void;

  mockClient.get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = getWorkspaceCreationCapability();

  mockUserId = 'different-user';
  resolve({ data: allowed });
  await expect(pending).rejects.toThrow('workspaceCreation.contextChanged');
  const finalGuard = await ensureCanCreateWorkspace();

  mockServerUrl = 'https://another-server';
  expect(finalGuard).toThrow('workspaceCreation.contextChanged');
});

test.each(['workspace', 'import'])('a late %s POST response cannot enter the next account workflow', async (operation) => {
  let resolve!: (value: { data: unknown }) => void;
  let started!: () => void;
  const posted = new Promise<void>((done) => { started = done; });

  mockClient.post.mockImplementation(() => {
    started();
    return new Promise((done) => { resolve = done; });
  });
  const pending = operation === 'workspace'
    ? createWorkspace({ workspace_name: 'draft' })
    : createImportTask(new File(['draft'], 'draft.zip'), CreateImportTaskType.Notion);

  await posted;
  mockUserId = 'other';
  resolve({ data: { workspace_id: 'created', task_id: 'task', presigned_url: 'upload' } });
  await expect(pending).rejects.toThrow('workspaceCreation.contextChanged');
});

test('a replay recovers the original result without new-work admission or the legacy route', async () => {
  mockClient.get.mockResolvedValue({ data: { ...allowed, can_create_workspace: false } });
  const requestId = '2f168cc6-41dd-4c15-840a-bb8beca482ef';

  expect(await createWorkspace({ workspace_name: 'Original name' }, { replay: requestId })).toBe('new-workspace');
  // The server resolves a completed receipt before admission; the client must not pre-empt it.
  expect(mockClient.get).not.toHaveBeenCalled();
  expect(mockClient.post).toHaveBeenCalledWith('/api/workspace/create-with-request-id', {
    workspace_name: 'Original name',
    request_id: requestId,
  });
});

test('a replay never falls back to the legacy route after a 404', async () => {
  mockClient.post.mockRejectedValueOnce({ code: 404, httpStatus: 404 });
  await expect(createWorkspace({ workspace_name: 'Draft' }, { replay: 'request' })).rejects.toMatchObject({ code: 404 });
  expect(mockClient.post).toHaveBeenCalledTimes(1);
  expect(mockClient.post.mock.calls[0][0]).toBe('/api/workspace/create-with-request-id');
});

test('a new keyed attempt reserves its request ID only after fresh admission, right before sending', async () => {
  const order: string[] = [];
  const reserve = jest.fn(() => {
    order.push('reserve');
    return '2f168cc6-41dd-4c15-840a-bb8beca482ef';
  });

  mockClient.get.mockResolvedValueOnce({ data: { ...allowed, can_create_workspace: false } });
  await expect(createWorkspace({ workspace_name: 'Draft' }, { reserve })).rejects.toThrow('workspaceCreation.denied');
  expect(reserve).not.toHaveBeenCalled();
  expect(mockClient.post).not.toHaveBeenCalled();

  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  await expect(createWorkspace({ workspace_name: 'Draft' }, { reserve })).rejects.toThrow('workspaceCreation.unavailable');
  expect(reserve).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

  mockClient.post.mockImplementationOnce(async () => {
    order.push('post');
    return { data: { workspace_id: 'keyed-workspace' } };
  });
  expect(await createWorkspace({ workspace_name: 'Draft' }, { reserve })).toBe('keyed-workspace');
  expect(order).toEqual(['reserve', 'post']);
  expect(mockClient.post).toHaveBeenCalledWith('/api/workspace/create-with-request-id', {
    workspace_name: 'Draft',
    request_id: '2f168cc6-41dd-4c15-840a-bb8beca482ef',
  });
});

test('a reservation failure stops before sending', async () => {
  await expect(
    createWorkspace({ workspace_name: 'Draft' }, {
      reserve: () => {
        throw new Error('Quota');
      },
    })
  ).rejects.toThrow('Quota');
  expect(mockClient.post).not.toHaveBeenCalled();
});
