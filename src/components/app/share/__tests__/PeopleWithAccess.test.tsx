import EventEmitter from 'events';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  AccessLevel,
  IPeopleWithAccessType,
  Role,
  SharedUserAccessSource,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { PeopleWithAccess } from '@/components/app/share/PeopleWithAccess';
import { ShareSectionType } from '@/components/app/share/shareSectionType';

const mockRevokeAccess = jest.fn();
const mockSharePageToGroup = jest.fn();
const mockRevokeGroupAccess = jest.fn();
const mockNavigate = jest.fn();
const mockEventEmitter = new EventEmitter();
const mockGroupMutationResult = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    revokeAccess: (...args: unknown[]) => mockRevokeAccess(...args),
    sharePageToGroup: (...args: unknown[]) => mockSharePageToGroup(...args),
    revokeGroupAccess: (...args: unknown[]) => mockRevokeGroupAccess(...args),
    sharePageTo: jest.fn(),
    turnIntoMember: jest.fn(),
  },
  WorkspaceService: {
    getWorkspaceGroupMembers: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'owner@appflowy.io' }),
}));

jest.mock('@/components/app/share/PersonItem', () => ({
  PersonItem: ({
    person,
    onRemoveAccess,
    permissionChangeDisabledReason,
  }: {
    person: IPeopleWithAccessType;
    onRemoveAccess: (email: string) => Promise<void>;
    permissionChangeDisabledReason?: string;
  }) => (
    <button
      data-permission-change-disabled-reason={permissionChangeDisabledReason}
      onClick={() => void onRemoveAccess(person.email)}
    >
      {person.email}
    </button>
  ),
}));

jest.mock('@/components/app/share/GroupAccessLevelDropdown', () => ({
  GroupAccessLevelDropdown: ({
    group,
    canModify,
    canManageFullAccess,
    onAccessLevelChange,
    onRemoveAccess,
  }: {
    group: WorkspaceGroupViewPermission;
    canModify: boolean;
    canManageFullAccess: boolean;
    onAccessLevelChange: (groupId: string, accessLevel: AccessLevel) => Promise<AccessLevel | null | undefined>;
    onRemoveAccess: (groupId: string) => Promise<AccessLevel | null | undefined>;
  }) =>
    canModify ? (
      <>
        <button
          data-can-manage-full-access={String(canManageFullAccess)}
          onClick={() => void onAccessLevelChange(group.group_id, group.access_level).then(mockGroupMutationResult)}
        >
          update:{group.group_id}
        </button>
        <button onClick={() => void onRemoveAccess(group.group_id).then(mockGroupMutationResult)}>
          remove:{group.group_id}
        </button>
      </>
    ) : (
      <span data-testid={`group-access-readonly:${group.group_id}`}>{group.access_level}</span>
    ),
}));

const removedPerson: IPeopleWithAccessType = {
  email: 'removed@appflowy.io',
  name: 'Removed user',
  access_level: AccessLevel.ReadOnly,
  role: Role.Guest,
  avatar_url: '',
  pending_invitation: false,
};

const sharedGroup: WorkspaceGroupViewPermission = {
  group_id: 'group-1',
  name: 'Engineering',
  access_level: AccessLevel.ReadAndWrite,
  member_count: 3,
  source: 'direct',
};

const groupOnlyPerson: IPeopleWithAccessType = {
  email: 'group-only@appflowy.io',
  name: 'Group only member',
  access_level: AccessLevel.ReadAndWrite,
  role: Role.Member,
  avatar_url: '',
  pending_invitation: false,
  access_source: SharedUserAccessSource.WorkspaceGroup,
};

const directPerson: IPeopleWithAccessType = {
  ...groupOnlyPerson,
  email: 'direct@appflowy.io',
  name: 'Directly shared member',
  access_source: SharedUserAccessSource.DirectShare,
};

describe('PeopleWithAccess', () => {
  beforeEach(() => {
    mockRevokeAccess.mockReset();
    mockRevokeAccess.mockResolvedValue(undefined);
    mockSharePageToGroup.mockReset();
    mockSharePageToGroup.mockResolvedValue(undefined);
    mockRevokeGroupAccess.mockReset();
    mockRevokeGroupAccess.mockResolvedValue(undefined);
    mockNavigate.mockReset();
    mockGroupMutationResult.mockReset();
  });

  it('disables person access changes for a database row page', () => {
    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[removedPerson]}
        groups={[]}
        editableGroupIds={new Set()}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        disablePersonAccessChanges
        sectionType={ShareSectionType.Shared}
      />
    );

    expect(screen.getByText(removedPerson.email).dataset.permissionChangeDisabledReason).toBe(
      'shareAction.databaseRowPagePermissionChangeDisabled'
    );
  });

  it('optimistically removes a successfully revoked row before revalidation', async () => {
    const onPeopleChange = jest.fn(async () => undefined);
    const onPersonRemoved = jest.fn();

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[removedPerson]}
        groups={[]}
        editableGroupIds={new Set()}
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={onPersonRemoved}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(removedPerson.email));

    await waitFor(() => expect(onPeopleChange).toHaveBeenCalledTimes(1));
    expect(mockRevokeAccess).toHaveBeenCalledWith('workspace-1', 'view-1', [removedPerson.email]);
    expect(onPersonRemoved).toHaveBeenCalledTimes(1);
    expect(onPersonRemoved).toHaveBeenCalledWith(removedPerson.email);
  });

  it('optimistically updates a group access level before revalidation', async () => {
    const onPeopleChange = jest.fn(async () => undefined);
    const updateGroupInAccessList = jest.fn();

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={updateGroupInAccessList}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(`update:${sharedGroup.group_id}`));

    await waitFor(() => expect(onPeopleChange).toHaveBeenCalledTimes(1));
    expect(mockSharePageToGroup).toHaveBeenCalledWith(
      'workspace-1',
      'view-1',
      sharedGroup.group_id,
      sharedGroup.access_level
    );
    expect(updateGroupInAccessList).toHaveBeenCalledWith(sharedGroup.group_id, sharedGroup.access_level);
    expect(mockSharePageToGroup.mock.invocationCallOrder[0]).toBeLessThan(
      updateGroupInAccessList.mock.invocationCallOrder[0]
    );
    expect(updateGroupInAccessList.mock.invocationCallOrder[0]).toBeLessThan(onPeopleChange.mock.invocationCallOrder[0]);
  });

  it('optimistically removes a group before revalidation', async () => {
    const onPeopleChange = jest.fn(async () => undefined);
    const updateGroupInAccessList = jest.fn();

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={updateGroupInAccessList}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(`remove:${sharedGroup.group_id}`));

    await waitFor(() => expect(onPeopleChange).toHaveBeenCalledTimes(1));
    expect(mockRevokeGroupAccess).toHaveBeenCalledWith('workspace-1', 'view-1', sharedGroup.group_id);
    expect(updateGroupInAccessList).toHaveBeenCalledWith(sharedGroup.group_id, null);
    expect(mockRevokeGroupAccess.mock.invocationCallOrder[0]).toBeLessThan(
      updateGroupInAccessList.mock.invocationCallOrder[0]
    );
    expect(updateGroupInAccessList.mock.invocationCallOrder[0]).toBeLessThan(onPeopleChange.mock.invocationCallOrder[0]);
  });

  it('does not expose group mutation controls without workspace-member group authority', () => {
    const updateGroupInAccessList = jest.fn();

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={updateGroupInAccessList}
        hasFullAccess
        canManageGroupAccess={false}
        canManageFullAccess={false}
        canGrantFullAccess={false}
        sectionType={ShareSectionType.Shared}
      />
    );

    expect(screen.getByText(sharedGroup.name)).toBeTruthy();
    expect(screen.getByTestId(`group-access-readonly:${sharedGroup.group_id}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: `update:${sharedGroup.group_id}` })).toBeNull();
    expect(screen.queryByRole('button', { name: `remove:${sharedGroup.group_id}` })).toBeNull();
    expect(mockSharePageToGroup).not.toHaveBeenCalled();
    expect(mockRevokeGroupAccess).not.toHaveBeenCalled();
    expect(updateGroupInAccessList).not.toHaveBeenCalled();
  });

  it('keeps inherited or stronger-effective group rows visible but disabled', () => {
    const { container } = render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[{ ...sharedGroup, access_level: AccessLevel.FullAccess, source: 'ancestor' }]}
        editableGroupIds={new Set()}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    expect(screen.getByText(sharedGroup.name)).toBeTruthy();
    expect(container.querySelector("[data-slot='workspace-group-icon']")).not.toBeNull();
    expect(container.querySelector("[data-slot='workspace-group-icon-container']")).not.toBeNull();
    expect(screen.getByTestId(`group-access-readonly:${sharedGroup.group_id}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: `update:${sharedGroup.group_id}` })).toBeNull();
    expect(screen.queryByRole('button', { name: `remove:${sharedGroup.group_id}` })).toBeNull();
  });

  it('passes the narrower Full Access management capability to group rows', () => {
    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess={false}
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    expect(screen.getByRole('button', { name: `update:${sharedGroup.group_id}` }).dataset.canManageFullAccess).toBe(
      'false'
    );
  });

  it('returns authoritative stronger effective access after a direct downgrade', async () => {
    const strongerEffectiveGroup = { ...sharedGroup, access_level: AccessLevel.FullAccess, source: 'ancestor' };

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={async () => ({
          effectiveGroups: [strongerEffectiveGroup],
          directGroups: [sharedGroup],
          effectiveGroupsLoaded: true,
          directGroupsLoaded: true,
        })}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(`update:${sharedGroup.group_id}`));

    await waitFor(() => expect(mockGroupMutationResult).toHaveBeenCalledWith(AccessLevel.FullAccess));
  });

  it('preserves an unverified refresh result instead of claiming inherited access', async () => {
    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(`update:${sharedGroup.group_id}`));

    await waitFor(() => expect(mockGroupMutationResult).toHaveBeenCalledWith(undefined));
  });

  it('returns inherited access after removing only the direct group grant', async () => {
    const inheritedGroup = { ...sharedGroup, access_level: AccessLevel.ReadOnly, source: 'ancestor' };

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={async () => ({
          effectiveGroups: [inheritedGroup],
          directGroups: [],
          effectiveGroupsLoaded: true,
          directGroupsLoaded: true,
        })}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(`remove:${sharedGroup.group_id}`));

    await waitFor(() => expect(mockGroupMutationResult).toHaveBeenCalledWith(AccessLevel.ReadOnly));
  });
  it('folds people whose only access comes from a listed group into the group row', () => {
    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[groupOnlyPerson, directPerson, removedPerson]}
        groups={[sharedGroup]}
        editableGroupIds={new Set([sharedGroup.group_id])}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    expect(screen.queryByText(groupOnlyPerson.email)).toBeNull();
    expect(screen.getByText(directPerson.email)).toBeTruthy();
    // Rows from older servers carry no source and must keep rendering.
    expect(screen.getByText(removedPerson.email)).toBeTruthy();
    expect(screen.getByText(sharedGroup.name)).toBeTruthy();
  });

  it('keeps group-sourced people listed when no group row can represent them', () => {
    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[groupOnlyPerson]}
        groups={[]}
        editableGroupIds={new Set()}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    expect(screen.getByText(groupOnlyPerson.email)).toBeTruthy();
  });

  it('only offers the group member toggle when the current user may explore members', () => {
    const renderList = (canExploreGroupMembers: boolean) => (
      <PeopleWithAccess
        viewId='view-1'
        people={[]}
        groups={[sharedGroup]}
        editableGroupIds={new Set()}
        isLoading={false}
        onPeopleChange={async () => undefined}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
        canManageGroupAccess
        canManageFullAccess
        canGrantFullAccess
        canExploreGroupMembers={canExploreGroupMembers}
        sectionType={ShareSectionType.Shared}
      />
    );
    const { rerender } = render(renderList(true));

    expect(screen.getByTestId(`share-group-toggle-${sharedGroup.group_id}`)).toBeTruthy();

    rerender(renderList(false));
    expect(screen.queryByTestId(`share-group-toggle-${sharedGroup.group_id}`)).toBeNull();
  });
});
