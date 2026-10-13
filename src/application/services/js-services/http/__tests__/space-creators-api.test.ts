import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';
import { WorkspaceSpaceCreationPolicy } from '@/application/workspace-permissions';

import {
  getWorkspaceSpaceCreationCapabilities,
  listWorkspaceSpaceCreators,
  setWorkspaceSpaceCreationPolicy,
  setWorkspaceSpaceCreator,
} from '../space-creators-api';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('../core', () => ({
  getAxios: () => ({ get: mockGet, post: mockPost, put: mockPut, delete: mockDelete }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
  executeAPIVoidRequest: async (request: () => Promise<unknown>) => {
    await request();
  },
}));

const workspaceId = '1053b770-ef6d-4e8f-8485-a795a359d13c';
const principalId = 'cbde8f6b-7751-442b-9076-a2752f583be7';
const revision = { epoch: '9007199254740993', counter: '9223372036854775807' };
const capability = {
  workspace_id: workspaceId,
  policy: 'owners_and_selected_members',
  revision,
  selected_creators_supported: true,
  group_selection_supported: true,
  can_create_space: false,
  can_manage_space_creators: false,
  can_grant_creator_groups: false,
};

describe('selected space creator transport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retains exact revisions and distinguishes supported from permitted', async () => {
    mockGet.mockResolvedValue({ data: { data: capability } });
    await expect(getWorkspaceSpaceCreationCapabilities(workspaceId)).resolves.toEqual(capability);
    expect(mockGet).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/space-creation-capabilities`);
  });

  it.each([
    undefined,
    {},
    { ...capability, workspace_id: principalId },
    { ...capability, policy: 'unknown_future_mode' },
    { ...capability, revision: { epoch: 9007199254740993, counter: '1' } },
    { ...capability, revision: { epoch: '1', counter: '9223372036854775808' } },
    { ...capability, revision: { epoch: '-1', counter: '1' } },
    { ...capability, can_manage_space_creators: undefined },
    { ...capability, can_create_space: 'true' },
  ])('rejects unavailable, foreign, unknown, or malformed capabilities: %p', async (value) => {
    mockGet.mockResolvedValue({ data: { data: value } });
    await expect(getWorkspaceSpaceCreationCapabilities(workspaceId)).rejects.toThrow(
      'workspacePermissions.invalidResponse'
    );
  });

  it('preserves an older server error without inventing permissive defaults', async () => {
    mockGet.mockRejectedValue(new Error('Not found'));
    await expect(getWorkspaceSpaceCreationCapabilities(workspaceId)).rejects.toThrow('Not found');
  });

  it('sends only the exact policy and its two-mode field so other settings and selections survive', async () => {
    mockPost.mockResolvedValue({
      data: { data: { space_creation_policy: 'owners_only', exact_space_creation_policy: 'owners_only' } },
    });
    await setWorkspaceSpaceCreationPolicy(workspaceId, 'owners_only');
    expect(mockPost).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/settings`, {
      space_creation_policy: 'owners_only',
      exact_space_creation_policy: 'owners_only',
    });
  });

  it('confirms selected creators from the exact field while the two-mode field reports owners only', async () => {
    mockPost.mockResolvedValue({
      data: { data: { space_creation_policy: 'owners_only', exact_space_creation_policy: 'owners_and_selected_members' } },
    });
    await expect(setWorkspaceSpaceCreationPolicy(workspaceId, 'owners_and_selected_members')).resolves.toBeUndefined();
    expect(mockPost).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/settings`, {
      space_creation_policy: 'owners_and_selected_members',
      exact_space_creation_policy: 'owners_and_selected_members',
    });
  });

  it('confirms from the two-mode field when the server predates the exact field', async () => {
    mockPost.mockResolvedValue({ data: { data: { space_creation_policy: 'members_and_owners' } } });
    await expect(setWorkspaceSpaceCreationPolicy(workspaceId, 'members_and_owners')).resolves.toBeUndefined();
  });

  it.each<[unknown, WorkspaceSpaceCreationPolicy]>([
    // An older server ignored the change but still reported success.
    [{ space_creation_policy: 'members_and_owners' }, 'owners_only'],
    // The two-mode value alone cannot confirm Owners only while selected creators remain active.
    [{ space_creation_policy: 'owners_only', exact_space_creation_policy: 'owners_and_selected_members' }, 'owners_only'],
    [{ space_creation_policy: 'owners_only' }, 'owners_and_selected_members'],
    [{ space_creation_policy: 'owners_only', exact_space_creation_policy: 'unknown_future_mode' }, 'owners_only'],
    [undefined, 'owners_only'],
  ])('reports an unconfirmed policy change for %p', async (settings, policy) => {
    mockPost.mockResolvedValue({ data: { data: settings } });
    await expect(setWorkspaceSpaceCreationPolicy(workspaceId, policy)).rejects.toThrow(
      'workspacePermissions.changeNotConfirmed'
    );
  });

  it('rejects malformed input before any request with translated messages', async () => {
    await expect(
      setWorkspaceSpaceCreationPolicy(workspaceId, 'unknown_future_mode' as WorkspaceSpaceCreationPolicy)
    ).rejects.toThrow('workspacePermissions.invalidRequest');
    await expect(listWorkspaceSpaceCreators(workspaceId, { kind: 'user', limit: 0 })).rejects.toThrow(
      'workspacePermissions.invalidRequest'
    );
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('reports malformed selections and mutation results with translated messages', async () => {
    mockGet.mockResolvedValue({ data: { data: { selections: 'invalid', next_cursor: null } } });
    await expect(listWorkspaceSpaceCreators(workspaceId, { kind: 'group' })).rejects.toThrow(
      'workspacePermissions.invalidResponse'
    );
    mockPut.mockResolvedValue({ data: { data: { changed: 'yes', revision } } });
    await expect(setWorkspaceSpaceCreator(workspaceId, { type: 'user', id: principalId }, true)).rejects.toThrow(
      'workspacePermissions.changeNotConfirmed'
    );
  });

  it.each(['invalidRequest', 'invalidResponse', 'changeNotConfirmed'])(
    'has English and French copy for workspacePermissions.%s',
    (key) => {
      for (const translations of [en, fr] as Array<{ workspacePermissions: Record<string, unknown> }>) {
        expect(typeof translations.workspacePermissions[key]).toBe('string');
      }
    }
  );

  it.each(['user', 'group'] as const)('keeps a %s selection inactive and returns the cursor unchanged', async (kind) => {
    const row = {
      principal: { type: kind, id: principalId },
      name: 'Retained selection',
      granted_by: null,
      granted_at: '2026-10-11T12:00:00Z',
      revoked_at: '2026-10-11T13:00:00Z',
      eligible: false,
    };
    const result = { selections: [row], next_cursor: '9223372036854775806' };

    mockGet.mockResolvedValue({ data: { data: result } });
    await expect(
      listWorkspaceSpaceCreators(workspaceId, { kind, after: result.next_cursor, limit: 1 })
    ).resolves.toEqual(result);
    expect(mockGet).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/space-creators`, {
      params: { kind, after: result.next_cursor, limit: 1 },
    });
  });

  it('rejects a numeric principal instead of rounding a server UID', async () => {
    const principal = { type: 'user' as const, id: 9007199254740993 as unknown as string };

    await expect(setWorkspaceSpaceCreator(workspaceId, principal, true)).rejects.toThrow(
      'workspacePermissions.invalidRequest'
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('grants/revokes one UUID with no submitted actor or replace-all roster', async () => {
    const result = { changed: true, revision };

    mockPut.mockResolvedValue({ data: { data: result } });
    mockDelete.mockResolvedValue({ data: { data: { ...result, changed: false } } });
    await expect(setWorkspaceSpaceCreator(workspaceId, { type: 'user', id: principalId }, true)).resolves.toEqual(
      result
    );
    await expect(setWorkspaceSpaceCreator(workspaceId, { type: 'group', id: principalId }, false)).resolves.toEqual({
      ...result,
      changed: false,
    });
    expect(mockPut).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/space-creators/users/${principalId}`);
    expect(mockDelete).toHaveBeenCalledWith(`/api/workspace/${workspaceId}/space-creators/groups/${principalId}`);
  });
});
