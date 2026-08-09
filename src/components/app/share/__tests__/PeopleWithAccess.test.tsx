import EventEmitter from 'events';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, IPeopleWithAccessType, Role, WorkspaceGroupViewPermission } from '@/application/types';
import { PeopleWithAccess } from '@/components/app/share/PeopleWithAccess';
import { ShareSectionType } from '@/components/app/share/shareSectionType';

const mockRevokeAccess = jest.fn();
const mockSharePageToGroup = jest.fn();
const mockRevokeGroupAccess = jest.fn();
const mockNavigate = jest.fn();
const mockEventEmitter = new EventEmitter();

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
  }: {
    person: IPeopleWithAccessType;
    onRemoveAccess: (email: string) => Promise<void>;
  }) => <button onClick={() => void onRemoveAccess(person.email)}>{person.email}</button>,
}));

jest.mock('@/components/app/share/GroupAccessLevelDropdown', () => ({
  GroupAccessLevelDropdown: ({
    group,
    onAccessLevelChange,
    onRemoveAccess,
  }: {
    group: WorkspaceGroupViewPermission;
    onAccessLevelChange: (groupId: string, accessLevel: AccessLevel) => Promise<void>;
    onRemoveAccess: (groupId: string) => Promise<void>;
  }) => (
    <>
      <button onClick={() => void onAccessLevelChange(group.group_id, group.access_level)}>
        update:{group.group_id}
      </button>
      <button onClick={() => void onRemoveAccess(group.group_id)}>remove:{group.group_id}</button>
    </>
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

describe('PeopleWithAccess', () => {
  beforeEach(() => {
    mockRevokeAccess.mockReset();
    mockRevokeAccess.mockResolvedValue(undefined);
    mockSharePageToGroup.mockReset();
    mockSharePageToGroup.mockResolvedValue(undefined);
    mockRevokeGroupAccess.mockReset();
    mockRevokeGroupAccess.mockResolvedValue(undefined);
    mockNavigate.mockReset();
  });

  it('optimistically removes a successfully revoked row before revalidation', async () => {
    const onPeopleChange = jest.fn(async () => undefined);
    const onPersonRemoved = jest.fn();

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[removedPerson]}
        groups={[]}
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={onPersonRemoved}
        updateGroupInAccessList={jest.fn()}
        hasFullAccess
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
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={updateGroupInAccessList}
        hasFullAccess
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
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={jest.fn()}
        updateGroupInAccessList={updateGroupInAccessList}
        hasFullAccess
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
});
