import { getServerHostingMode, getServerInfoSnapshot } from '@/utils/server-info';

import { getServerInfo } from '../auth-api';
import { createImportTask, CreateImportTaskType, createConfluenceImportTask } from '../import-api';
import { createWorkspace } from '../workspace-api';
import { ensureCanCreateWorkspace, getWorkspaceCreationCapability } from '../workspace-creation-api';

const mockClient = { get: jest.fn(), post: jest.fn() };
let mockUserId = 'user';
let mockServerUrl = 'https://server';

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockServerUrl }));
jest.mock('../auth-api', () => ({ getServerInfo: jest.fn() }));
jest.mock('@/utils/server-info', () => ({ getServerHostingMode: jest.fn(), getServerInfoSnapshot: jest.fn() }));
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
  jest.mocked(getServerInfoSnapshot).mockReturnValue({ status: 'available', info: { enable_page_history: false } });
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

test.each(['cloud', 'self-hosted', 'unknown'] as const)(
  'only verified hosted installations retain the old missing-route behavior: %s',
  async (mode) => {
    mockClient.get.mockRejectedValue({ code: 404 });
    jest.mocked(getServerHostingMode).mockReturnValue(mode);
    if (mode === 'cloud')
      expect(await getWorkspaceCreationCapability()).toMatchObject({ supported: false, can_create_workspace: true });
    else await expect(getWorkspaceCreationCapability()).rejects.toMatchObject({ code: 404 });
  }
);

test('the standalone import route can positively identify a legacy hosted server', async () => {
  mockClient.get.mockRejectedValue({ code: 404 });
  jest.mocked(getServerInfoSnapshot).mockReturnValue({ status: 'loading' });
  jest.mocked(getServerInfo).mockResolvedValue({ self_hosted: false, enable_page_history: false });
  jest.mocked(getServerHostingMode).mockReturnValue('cloud');
  expect(await getWorkspaceCreationCapability()).toMatchObject({ can_create_workspace: true });
  expect(getServerInfo).toHaveBeenCalledTimes(1);
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

test('receipt replay can recover an earlier result after a fresh capability denies new creation', async () => {
  mockClient.get.mockResolvedValue({ data: { ...allowed, can_create_workspace: false } });
  const requestId = '2f168cc6-41dd-4c15-840a-bb8beca482ef';

  expect(await createWorkspace({ workspace_name: 'Original name' }, { requestId, replay: true })).toBe('new-workspace');
  expect(mockClient.get).toHaveBeenCalledWith('/api/user/workspace-creation-capability');
  expect(mockClient.post).toHaveBeenCalledWith('/api/workspace/create-with-request-id', {
    workspace_name: 'Original name', request_id: requestId,
  });
});

test('a new keyed attempt still requires fresh admission and never falls back after an unsupported route', async () => {
  const receipt = { requestId: '2f168cc6-41dd-4c15-840a-bb8beca482ef', replay: false };

  mockClient.get.mockResolvedValueOnce({ data: { ...allowed, can_create_workspace: false } });
  await expect(createWorkspace({ workspace_name: 'Draft' }, receipt)).rejects.toThrow('workspaceCreation.denied');
  expect(mockClient.post).not.toHaveBeenCalled();
  mockClient.post.mockRejectedValueOnce({ code: 404 });
  await expect(createWorkspace({ workspace_name: 'Draft' }, receipt)).rejects.toMatchObject({ code: 404 });
  expect(mockClient.post).toHaveBeenCalledTimes(1);
  expect(mockClient.post.mock.calls[0][0]).toBe('/api/workspace/create-with-request-id');
});
