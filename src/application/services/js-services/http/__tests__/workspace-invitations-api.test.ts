import { listPendingWorkspaceInvitations } from '../workspace-api';

const mockClient = { get: jest.fn() };
let mockUserId = 'user';

jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUserId } }) }));
jest.mock('../core', () => ({
  getAxios: () => mockClient,
  executeAPIRequest: async (request: () => Promise<{ data: unknown }>) => (await request()).data,
  executeAPIVoidRequest: async (request: () => Promise<unknown>) => {
    await request();
  },
}));
jest.mock('i18next', () => ({ t: (key: string) => key }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user';
});

test('lists only pending invitations for the signed-in account, with readable fallbacks', async () => {
  mockClient.get.mockResolvedValue({
    data: [
      {
        invite_id: 'invite-1',
        workspace_id: 'workspace-1',
        workspace_name: null,
        inviter_name: null,
        inviter_email: 'owner@example.com',
        inviter_icon: null,
        invitee_email: 'person@example.com',
        status: 'Pending',
        updated_at: '2026-10-13T00:00:00Z',
        workspace_icon: '',
        member_count: null,
      },
      { invite_id: 'invite-2', workspace_id: 'workspace-2', status: 'Accepted' },
      { invite_id: 3, workspace_id: 'workspace-3', status: 'Pending' },
      null,
    ],
  });

  expect(await listPendingWorkspaceInvitations()).toEqual([
    {
      invite_id: 'invite-1',
      workspace_id: 'workspace-1',
      workspace_name: '',
      inviter_name: '',
      inviter_email: 'owner@example.com',
      inviter_icon: '',
      workspace_icon: '',
      member_count: 0,
      status: 'Pending',
    },
  ]);
  expect(mockClient.get).toHaveBeenCalledWith('/api/workspace/invite', { params: { status: 'Pending' } });
});

test('rejects a response that is not a list', async () => {
  mockClient.get.mockResolvedValue({ data: { invite_id: 'invite-1' } });
  await expect(listPendingWorkspaceInvitations()).rejects.toThrow('Invalid workspace invitation list');
});

test('a late response cannot show another account its invitations', async () => {
  let resolve!: (value: { data: unknown }) => void;

  mockClient.get.mockReturnValue(new Promise((done) => (resolve = done)));
  const pending = listPendingWorkspaceInvitations();

  mockUserId = 'other';
  resolve({ data: [] });
  await expect(pending).rejects.toThrow('workspaceCreation.contextChanged');
});
