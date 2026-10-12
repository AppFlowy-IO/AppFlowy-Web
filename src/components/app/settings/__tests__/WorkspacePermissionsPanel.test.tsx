import EventEmitter from 'events';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';

import { Role } from '@/application/types';
import { SpaceCreatorSelections, WorkspaceSpaceCreationCapabilities } from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';

import { WorkspacePermissionsPanel } from '../WorkspacePermissionsPanel';

const workspaceId = '1053b770-ef6d-4e8f-8485-a795a359d13c';
const userId = 'cbde8f6b-7751-442b-9076-a2752f583be7';
const groupId = 'a9897632-edee-47e0-ae03-0996cc65d7a2';
const emitter = new EventEmitter();
const mockRead = jest.fn();
const mockPolicy = jest.fn();
const mockList = jest.fn();
const mockMutate = jest.fn();
const mockMembers = jest.fn();
const mockGroups = jest.fn();
let current: WorkspaceSpaceCreationCapabilities;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'operator' }));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getWorkspaceSpaceCreationCapabilities: (...args: unknown[]) => mockRead(...args),
    setWorkspaceSpaceCreationPolicy: (...args: unknown[]) => mockPolicy(...args),
    listWorkspaceSpaceCreators: (...args: unknown[]) => mockList(...args),
    setWorkspaceSpaceCreator: (...args: unknown[]) => mockMutate(...args),
    getMembers: (...args: unknown[]) => mockMembers(...args),
    getWorkspaceGroups: (...args: unknown[]) => mockGroups(...args),
  },
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthInternalContext.Provider
      value={{
        isAuthenticated: true,
        currentWorkspaceId: workspaceId,
        onChangeWorkspace: jest.fn(),
      }}
    >
      <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
    </AuthInternalContext.Provider>
  );
}

function selection(kind: 'user' | 'group', revoked = false): SpaceCreatorSelections {
  return {
    selections: [
      {
        principal: { type: kind, id: kind === 'user' ? userId : groupId },
        name: kind === 'user' ? 'Selected member' : 'Selected group',
        granted_by: userId,
        granted_at: '2026-10-11T12:00:00Z',
        revoked_at: revoked ? '2026-10-11T13:00:00Z' : null,
        eligible: true,
      },
    ],
    next_cursor: null,
  };
}

describe('workspace permission settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emitter.removeAllListeners();
    current = {
      workspace_id: workspaceId,
      policy: 'owners_only',
      revision: { epoch: '1', counter: '1' },
      selected_creators_supported: true,
      group_selection_supported: true,
      can_create_space: true,
      can_manage_space_creators: true,
      can_grant_creator_groups: true,
    };
    mockRead.mockImplementation(async () => current);
    mockPolicy.mockImplementation(async (_workspace, policy) => {
      current = { ...current, policy };
    });
    mockList.mockResolvedValue({ selections: [], next_cursor: null });
    mockMutate.mockResolvedValue({ changed: true, revision: { epoch: '1', counter: '2' } });
    mockMembers.mockResolvedValue([
      { user_uuid: userId, uid: '9007199254740993', name: 'Eligible', email: 'member@test.local', role: Role.Member },
      { user_uuid: groupId, name: 'Guest', role: Role.Guest },
      { user_uuid: groupId, name: 'Owner', role: Role.Owner },
      { user_uuid: groupId, name: 'Pending', role: Role.Member, is_pending_invitation: true },
      { uid: '9007199254740995', name: 'Legacy identity', role: Role.Member },
    ]);
    mockGroups.mockResolvedValue({ groups: [{ group_id: groupId, name: 'W_RH_edit', member_count: 1 }] });
  });

  it('changes only the selected policy through the real controls', async () => {
    render(<WorkspacePermissionsPanel workspaceId={workspaceId} />, { wrapper: Wrapper });
    fireEvent.click(
      await screen.findByRole('radio', { name: 'workspacePermissions.policies.owners_and_selected_members' })
    );
    await waitFor(() => expect(mockPolicy).toHaveBeenCalledWith(workspaceId, 'owners_and_selected_members'));
    await waitFor(() =>
      expect(
        (
          screen.getByRole('radio', {
            name: 'workspacePermissions.policies.owners_and_selected_members',
          })
        ).checked
      ).toBe(true)
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('selects a stable UUID and excludes Guests, Owners, pending invites, and missing UUIDs', async () => {
    render(<WorkspacePermissionsPanel workspaceId={workspaceId} />, { wrapper: Wrapper });
    const users = await screen.findByRole('region', { name: 'workspacePermissions.users' });

    await within(users).findByRole('option', { name: 'Eligible (member@test.local)' });
    expect(within(users).queryByRole('option', { name: 'Guest' })).toBeNull();
    expect(within(users).queryByRole('option', { name: 'Owner' })).toBeNull();
    expect(within(users).queryByRole('option', { name: 'Pending' })).toBeNull();
    expect(within(users).queryByRole('option', { name: 'Legacy identity' })).toBeNull();
    fireEvent.change(within(users).getByRole('combobox'), { target: { value: userId } });
    fireEvent.click(within(users).getByRole('button', { name: 'workspacePermissions.add' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'user', id: userId }, true));
  });

  it('shows retained grants as inactive outside selected mode and permits their removal', async () => {
    mockList.mockImplementation(async (_workspace, { kind }) => selection(kind));
    render(<WorkspacePermissionsPanel workspaceId={workspaceId} />, { wrapper: Wrapper });
    const users = await screen.findByRole('region', { name: 'workspacePermissions.users' });

    await within(users).findByText('Selected member');
    expect(within(users).getByText('workspacePermissions.inactive')).toBeTruthy();
    fireEvent.click(within(users).getByRole('button', { name: 'workspacePermissions.remove' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'user', id: userId }, false));
  });

  it('keeps group revocation available without entitlement and does not expose the group picker', async () => {
    current.can_grant_creator_groups = false;
    mockList.mockImplementation(async (_workspace, { kind }) => selection(kind));
    render(<WorkspacePermissionsPanel workspaceId={workspaceId} />, { wrapper: Wrapper });
    const groups = await screen.findByRole('region', { name: 'workspacePermissions.groups' });

    await within(groups).findByText('Selected group');
    expect(within(groups).queryByRole('combobox')).toBeNull();
    // C loads its independent directory; the restricted B grant picker does not.
    expect(mockGroups).toHaveBeenCalledTimes(1);
    fireEvent.click(within(groups).getByRole('button', { name: 'workspacePermissions.remove' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'group', id: groupId }, false));
  });

  it('shows effective denial to a Member without fetching private selection rosters', async () => {
    current.can_create_space = false;
    current.can_manage_space_creators = false;
    render(<WorkspacePermissionsPanel workspaceId={workspaceId} />, { wrapper: Wrapper });
    await screen.findByText('workspacePermissions.denied');
    expect(mockList).not.toHaveBeenCalled();
    expect(mockMembers).not.toHaveBeenCalled();
    const radio = screen.getByRole('radio', { name: 'workspacePermissions.policies.members_and_owners' });

    expect(radio.closest('fieldset')?.disabled).toBe(true);
    fireEvent.click(radio);
    expect(mockPolicy).not.toHaveBeenCalled();
  });

  it('surfaces a failed grant and preserves the chosen target for an explicit retry', async () => {
    mockMutate.mockRejectedValue({ message: 'Selection is no longer eligible' });
    render(<WorkspacePermissionsPanel workspaceId={workspaceId} />, { wrapper: Wrapper });
    const users = await screen.findByRole('region', { name: 'workspacePermissions.users' });

    await within(users).findByRole('option', { name: 'Eligible (member@test.local)' });
    fireEvent.change(within(users).getByRole('combobox'), { target: { value: userId } });
    fireEvent.click(within(users).getByRole('button', { name: 'workspacePermissions.add' }));
    await within(users).findByRole('alert');
    expect((within(users).getByRole('combobox')).value).toBe(userId);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
