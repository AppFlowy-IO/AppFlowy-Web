import { getUserWorkspaceInfo } from '../user-api';

const mockGet = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet }),
  executeAPIRequest: async (request: () => Promise<{ data: unknown }>) => (await request()).data,
}));

beforeEach(() => mockGet.mockReset());

test('opts in to the empty-account answer, which older servers ignore', async () => {
  mockGet.mockResolvedValue({ data: { user_profile: { uuid: 'actor' }, visiting_workspace: null, workspaces: [] } });
  await getUserWorkspaceInfo();
  // Servers only send `visiting_workspace: null` to callers that declare they can read it.
  expect(mockGet).toHaveBeenCalledWith('/api/user/workspace', { params: { allow_empty: true } });
});

test('a signed-in account without a home has a successful empty workspace result', async () => {
  mockGet.mockResolvedValue({ data: { user_profile: { uuid: 'empty-actor' }, visiting_workspace: null, workspaces: [] } });
  expect(await getUserWorkspaceInfo()).toEqual({ user_id: 'empty-actor', selected_workspace: null, workspaces: [] });
});

test('an existing selected workspace retains its normal mapped payload', async () => {
  const workspace = { workspace_id: 'joined', workspace_name: 'Invited workspace', created_at: 'now',
    database_storage_id: 'catalog', owner_uid: 123, role: 2 };

  mockGet.mockResolvedValue({ data: { user_profile: { uuid: 'actor' }, visiting_workspace: workspace, workspaces: [workspace] } });
  const result = await getUserWorkspaceInfo();

  expect(result.selected_workspace).toEqual(result.workspaces[0]);
  expect(result.selected_workspace?.id).toBe('joined');
});
