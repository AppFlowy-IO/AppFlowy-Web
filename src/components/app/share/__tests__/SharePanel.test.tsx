import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import { AccessLevel } from '@/application/types';

import SharePanel from '../SharePanel';
import { ShareSectionType } from '../shareSectionType';

const mockGetSubscriptions = jest.fn(async () => []);
const mockLoadMentionableUsers = jest.fn(async () => []);
const mockInviteGuestProps = jest.fn();
const mockPeopleWithAccessProps = jest.fn();
let mockIsHosted = false;

jest.mock('@/components/app/app.hooks', () => ({
  useGetSubscriptions: () => mockGetSubscriptions,
  useLoadMentionableUsers: () => mockLoadMentionableUsers,
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: {
      role: 'Member',
    },
  }),
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
  GeneralAccess: () => <div data-testid='general-access' />,
}));

jest.mock('../CopyLink', () => ({
  CopyLink: () => <div data-testid='copy-link' />,
}));

function renderSharePanel(
  currentUserAccessLevel: AccessLevel | undefined,
  updateGroupInAccessList = jest.fn(),
  canManageFullAccess = false
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
      hasFullAccess={currentUserAccessLevel === AccessLevel.FullAccess}
      canManageFullAccess={canManageFullAccess}
      currentUserAccessLevel={currentUserAccessLevel}
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
    mockIsHosted = false;
  });

  it('hides invite controls for read-only users while keeping the access list visible', () => {
    renderSharePanel(AccessLevel.ReadOnly);

    expect(screen.queryByTestId('invite-guest')).toBeNull();
    expect(screen.getByTestId('people-with-access')).toBeTruthy();
    expect(screen.getByTestId('general-access')).toBeTruthy();
    expect(screen.getByTestId('copy-link')).toBeTruthy();
    expect(mockLoadMentionableUsers).not.toHaveBeenCalled();
  });

  it('keeps invite controls visible for edit users', async () => {
    renderSharePanel(AccessLevel.ReadAndWrite);

    expect(screen.getByTestId('invite-guest')).toBeTruthy();
    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
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

  it('uses owner-tier authority for Full Access invite and row controls', async () => {
    renderSharePanel(AccessLevel.FullAccess, jest.fn(), false);

    await waitFor(() => expect(mockLoadMentionableUsers).toHaveBeenCalledTimes(1));
    expect(mockInviteGuestProps).toHaveBeenCalledWith(expect.objectContaining({ canGrantFullAccess: false }));
    expect(mockPeopleWithAccessProps).toHaveBeenCalledWith(
      expect.objectContaining({ canGrantFullAccess: false, canManageFullAccess: false, hasFullAccess: true })
    );
  });
});
