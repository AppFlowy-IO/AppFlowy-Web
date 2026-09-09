import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, Role } from '@/application/types';

import SharePanel from '../SharePanel';
import { ShareSectionType } from '../shareSectionType';

const mockGetSubscriptions = jest.fn(async () => []);
const mockLoadMentionableUsers = jest.fn(async () => []);
const mockInviteGuestProps = jest.fn();
const mockPeopleWithAccessProps = jest.fn();
const mockGeneralAccessProps = jest.fn();
let mockIsHosted = false;
let mockWorkspaceRole: Role | undefined = Role.Member;
let mockWorkspaceOwnerUid: string | number = '101';
let mockCurrentUserUid: string | number = '202';

jest.mock('@/components/app/app.hooks', () => ({
  useGetSubscriptions: () => mockGetSubscriptions,
  useLoadMentionableUsers: () => mockLoadMentionableUsers,
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: {
      role: mockWorkspaceRole,
      owner: { uid: mockWorkspaceOwnerUid },
    },
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: mockCurrentUserUid }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
  },
}));

jest.mock('@/utils/subscription', () => ({
  getProAccessPlanFromSubscriptions: () => null,
  isAppFlowyHosted: () => mockIsHosted,
}));

jest.mock('../InviteGuest', () => ({
  InviteGuest: (props: unknown) => {
    mockInviteGuestProps(props);
    return <div data-testid='invite-guest' />;
  },
}));

jest.mock('../PeopleWithAccess', () => ({
  PeopleWithAccess: (props: unknown) => {
    mockPeopleWithAccessProps(props);
    return <div data-testid='people-with-access' />;
  },
}));

jest.mock('../GeneralAccess', () => ({
  GeneralAccess: (props: unknown) => {
    mockGeneralAccessProps(props);
    return <div data-testid='general-access' />;
  },
}));

jest.mock('../CopyLink', () => ({
  CopyLink: () => <div data-testid='copy-link' />,
}));

function renderSharePanel(
  currentUserAccessLevel: AccessLevel | undefined,
  updateGroupInAccessList = jest.fn(),
  canManageFullAccess = false,
  hasFullAccess = currentUserAccessLevel === AccessLevel.FullAccess,
  generalAccessLevel: AccessLevel | null = null,
  disablePersonAccessChanges = false
) {
  return render(
    <SharePanel
      viewId='view-1'
      people={[]}
      groups={[]}
      editableGroupIds={new Set()}
      isLoadingPeople={false}
      onPeopleChange={async () => undefined}
      onPersonRemoved={() => undefined}
      updateGroupInAccessList={updateGroupInAccessList}
      hasFullAccess={hasFullAccess}
      canManageFullAccess={canManageFullAccess}
      disablePersonAccessChanges={disablePersonAccessChanges}
      currentUserAccessLevel={currentUserAccessLevel}
      generalAccessLevel={generalAccessLevel}
      sectionType={ShareSectionType.Private}
    />
  );
}

describe('SharePanel', () => {
  beforeEach(() => {
    mockGetSubscriptions.mockClear();
    mockLoadMentionableUsers.mockClear();
    mockInviteGuestProps.mockClear();
    mockPeopleWithAccessProps.mockClear();
    mockGeneralAccessProps.mockClear();
    mockIsHosted = false;
    mockWorkspaceRole = Role.Member;
    mockWorkspaceOwnerUid = '101';
    mockCurrentUserUid = '202';
  });

  it('hides invite controls for read-only users while keeping the access list visible', () => {
    renderSharePanel(AccessLevel.ReadOnly);

    expect(screen.queryByTestId('invite-guest')).toBeNull();
    expect(screen.getByTestId('people-with-access')).toBeTruthy();
    expect(screen.getByTestId('general-access')).toBeTruthy();
    expect(screen.getByTestId('copy-link')).toBeTruthy();
    expect(mockLoadMentionableUsers).not.toHaveBeenCalled();
  });

  it('keeps disabled invite controls visible for edit users without can_share', async () => {
    renderSharePanel(AccessLevel.ReadAndWrite);

    expect(screen.getByTestId('invite-guest')).toBeTruthy();
    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(expect.objectContaining({ hasFullAccess: false }));
  });

  it('does not infer can_share from a stale Full Access display level', async () => {
    renderSharePanel(AccessLevel.FullAccess, jest.fn(), false, false);

    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(expect.objectContaining({ hasFullAccess: false }));
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(expect.objectContaining({ hasFullAccess: false }));
  });

  it('does not load subscription data when invite controls are hidden', () => {
    mockIsHosted = true;

    renderSharePanel(AccessLevel.ReadOnly);

    expect(screen.queryByTestId('invite-guest')).toBeNull();
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
  });

  it('forwards group mutation state to the access list', () => {
    const updateGroupInAccessList = jest.fn();

    renderSharePanel(AccessLevel.ReadOnly, updateGroupInAccessList, true);

    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ updateGroupInAccessList, canManageFullAccess: true })
    );
  });

  it('only lets workspace owners expand group rows to explore members', () => {
    renderSharePanel(AccessLevel.ReadOnly);

    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ canExploreGroupMembers: false })
    );

    mockPeopleWithAccessProps.mockClear();
    mockWorkspaceRole = Role.Owner;
    renderSharePanel(AccessLevel.ReadOnly);

    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ canExploreGroupMembers: true })
    );
  });

  it('forwards the database row-page person access restriction', () => {
    renderSharePanel(AccessLevel.ReadOnly, jest.fn(), true, true, null, true);

    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ disablePersonAccessChanges: true })
    );
  });

  it('forwards the governing-space General access level', () => {
    renderSharePanel(AccessLevel.ReadOnly, jest.fn(), true, false, AccessLevel.ReadAndComment);

    expect(mockGeneralAccessProps).toHaveBeenCalledWith({
      sectionType: ShareSectionType.Private,
      accessLevel: AccessLevel.ReadAndComment,
    });
  });

  it('uses owner-tier authority for Full Access invite and row controls', async () => {
    mockWorkspaceRole = Role.Owner;
    renderSharePanel(AccessLevel.FullAccess, jest.fn(), false);

    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(expect.objectContaining({ canGrantFullAccess: false }));
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ canGrantFullAccess: false, canManageFullAccess: false, hasFullAccess: true })
    );
  });

  it('allows a workspace member with page Full Access to manage group grants', async () => {
    renderSharePanel(AccessLevel.FullAccess);

    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(
      expect.objectContaining({ canManageGroupAccess: true, isWorkspaceOwner: false })
    );
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(expect.objectContaining({ canManageGroupAccess: true }));
  });

  it('recognizes the workspace owner by UID when the role projection is missing', async () => {
    mockWorkspaceRole = undefined;
    mockWorkspaceOwnerUid = '9007199254740993';
    mockCurrentUserUid = '9007199254740993';

    renderSharePanel(AccessLevel.FullAccess);

    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(
      expect.objectContaining({ canManageGroupAccess: true, isWorkspaceOwner: true })
    );
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(expect.objectContaining({ canManageGroupAccess: true }));
  });

  it('does not allow a workspace member without can_share to manage group grants', async () => {
    renderSharePanel(AccessLevel.ReadAndWrite);

    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(expect.objectContaining({ canManageGroupAccess: false }));
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(expect.objectContaining({ canManageGroupAccess: false }));
  });

  it('keeps person sharing available to a Full Access guest without exposing group management', async () => {
    mockWorkspaceRole = Role.Guest;
    renderSharePanel(AccessLevel.FullAccess);

    expect(screen.getByTestId('invite-guest')).toBeTruthy();
    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(
      expect.objectContaining({ hasFullAccess: true, canManageGroupAccess: false })
    );
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ hasFullAccess: true, canManageGroupAccess: false })
    );
  });
});
