import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import { AccessLevel } from '@/application/types';

import SharePanel from '../SharePanel';
import { ShareSectionType } from '../shareSectionType';

const mockGetSubscriptions = jest.fn(async () => []);
const mockLoadMentionableUsers = jest.fn(async () => []);
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
  InviteGuest: () => <div data-testid='invite-guest' />,
}));

jest.mock('../PeopleWithAccess', () => ({
  PeopleWithAccess: () => <div data-testid='people-with-access' />,
}));

jest.mock('../GeneralAccess', () => ({
  GeneralAccess: () => <div data-testid='general-access' />,
}));

jest.mock('../CopyLink', () => ({
  CopyLink: () => <div data-testid='copy-link' />,
}));

function renderSharePanel(currentUserAccessLevel: AccessLevel | undefined) {
  return render(
    <SharePanel
      viewId='view-1'
      people={[]}
      isLoadingPeople={false}
      onPeopleChange={async () => undefined}
      onPersonRemoved={() => undefined}
      hasFullAccess={currentUserAccessLevel === AccessLevel.FullAccess}
      currentUserAccessLevel={currentUserAccessLevel}
      sectionType={ShareSectionType.Private}
    />
  );
}

describe('SharePanel', () => {
  beforeEach(() => {
    mockGetSubscriptions.mockClear();
    mockLoadMentionableUsers.mockClear();
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
});
