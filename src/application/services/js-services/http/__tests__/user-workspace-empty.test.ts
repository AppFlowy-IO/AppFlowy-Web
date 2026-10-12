import { getUserWorkspaceInfo } from '../user-api';

const mockGet = jest.fn();

jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet }),
  executeAPIRequest: async (request: () => Promise<{ data: unknown }>) => (await request()).data,
}));

test('a signed-in account without a home has a successful empty workspace result', async () => {
  mockGet.mockResolvedValue({ data: { user_profile: { uuid: 'empty-actor' }, visiting_workspace: null, workspaces: [] } });
  expect(await getUserWorkspaceInfo()).toEqual({ user_id: 'empty-actor', selected_workspace: null, workspaces: [] });
  expect(mockGet).toHaveBeenCalledWith('/api/user/workspace');
});

test('an existing selected workspace retains its normal mapped payload', async () => {
  const workspace = { workspace_id: 'joined', workspace_name: 'Invited workspace', created_at: 'now',
    database_storage_id: 'catalog', owner_uid: 123, role: 2 };

  mockGet.mockResolvedValue({ data: { user_profile: { uuid: 'actor' }, visiting_workspace: workspace, workspaces: [workspace] } });
  const result = await getUserWorkspaceInfo();

  expect(result.selected_workspace).toEqual(result.workspaces[0]);
  expect(result.selected_workspace?.id).toBe('joined');
});
