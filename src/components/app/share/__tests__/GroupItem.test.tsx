import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, IPeopleWithAccessType, Role, WorkspaceGroupViewPermission } from '@/application/types';
import { GroupItem } from '@/components/app/share/GroupItem';

const mockGetWorkspaceGroupMembers = jest.fn();
const mockNotifyError = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getWorkspaceGroupMembers: (...args: unknown[]) => mockGetWorkspaceGroupMembers(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'owner@appflowy.io' }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: (...args: unknown[]) => mockNotifyError(...args),
    success: jest.fn(),
  },
}));

jest.mock('@/components/app/share/PersonAvatar', () => ({
  PersonAvatar: ({ name, avatarUrl }: { name: string; avatarUrl?: string }) => (
    <span data-testid='person-avatar' data-avatar-url={avatarUrl}>
      {name}
    </span>
  ),
}));

jest.mock('@/components/app/share/GroupAccessLevelDropdown', () => ({
  GroupAccessLevelDropdown: ({ group }: { group: WorkspaceGroupViewPermission }) => (
    <span data-testid={`group-access:${group.group_id}`}>{group.access_level}</span>
  ),
}));

const sharedGroup: WorkspaceGroupViewPermission = {
  group_id: 'group-1',
  name: 'Product',
  access_level: AccessLevel.ReadOnly,
  member_count: 2,
  source: 'manual',
};

const annie: IPeopleWithAccessType = {
  email: 'annie@appflowy.io',
  name: 'Annie at AppFlowy',
  access_level: AccessLevel.ReadOnly,
  role: Role.Member,
  avatar_url: 'https://example.com/annie.png',
  pending_invitation: false,
};

function renderGroupItem(overrides: Partial<React.ComponentProps<typeof GroupItem>> = {}) {
  return render(
    <GroupItem
      group={sharedGroup}
      peopleByEmail={new Map([[annie.email, annie]])}
      canExploreMembers
      canModify
      currentUserHasFullAccess
      canManageFullAccess
      onAccessLevelChange={async () => undefined}
      onRemoveAccess={async () => undefined}
      {...overrides}
    />
  );
}

describe('GroupItem', () => {
  beforeEach(() => {
    mockGetWorkspaceGroupMembers.mockReset();
    mockNotifyError.mockReset();
  });

  it('renders the group summary without a member toggle when members cannot be explored', () => {
    const { container } = renderGroupItem({ canExploreMembers: false });

    expect(screen.getByText(sharedGroup.name)).toBeTruthy();
    expect(screen.getByText('shareAction.groupMembersCount')).toBeTruthy();
    expect(screen.queryByTestId(`share-group-toggle-${sharedGroup.group_id}`)).toBeNull();
    expect(container.querySelector("[data-slot='workspace-group-icon-container']")).not.toBeNull();
    expect(mockGetWorkspaceGroupMembers).not.toHaveBeenCalled();
  });

  it('loads and lists the members of the group when expanded', async () => {
    mockGetWorkspaceGroupMembers.mockResolvedValueOnce({
      members: [
        { uid: '1', email: 'annie@appflowy.io', name: '' },
        { uid: '2', email: 'owner@appflowy.io', name: 'Owner' },
        { uid: '3', email: null, name: null },
      ],
    });

    renderGroupItem();

    const toggle = screen.getByTestId(`share-group-toggle-${sharedGroup.group_id}`);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);

    const annieRow = await screen.findByTestId('share-group-member-1');

    expect(mockGetWorkspaceGroupMembers).toHaveBeenCalledWith('workspace-1', sharedGroup.group_id);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // A member without a server-side name falls back to the access-details row, avatar included.
    expect(annieRow.textContent).toContain(annie.name);
    expect(annieRow.textContent).toContain(annie.email);
    expect(annieRow.querySelector("[data-testid='person-avatar']")?.getAttribute('data-avatar-url')).toBe(
      annie.avatar_url
    );
    expect(screen.getByTestId('share-group-member-2').textContent).toContain('shareAction.you');
    expect(screen.getByTestId('share-group-member-3').textContent).toContain(
      'settings.appearance.people.userFallbackName'
    );

    fireEvent.click(toggle);
    expect(screen.queryByTestId(`share-group-members-${sharedGroup.group_id}`)).toBeNull();

    // Re-opening reuses the loaded roster instead of fetching again.
    fireEvent.click(toggle);
    expect(screen.getByTestId('share-group-member-1')).toBeTruthy();
    expect(mockGetWorkspaceGroupMembers).toHaveBeenCalledTimes(1);
  });

  it('reloads the roster when the group member count changes while expanded', async () => {
    mockGetWorkspaceGroupMembers
      .mockResolvedValueOnce({ members: [{ uid: '1', email: 'annie@appflowy.io', name: 'Annie' }] })
      .mockResolvedValueOnce({
        members: [
          { uid: '1', email: 'annie@appflowy.io', name: 'Annie' },
          { uid: '4', email: 'nate@appflowy.io', name: 'Nate' },
        ],
      });

    const { rerender } = renderGroupItem();

    fireEvent.click(screen.getByTestId(`share-group-toggle-${sharedGroup.group_id}`));
    await screen.findByTestId('share-group-member-1');

    rerender(
      <GroupItem
        group={{ ...sharedGroup, member_count: 3 }}
        peopleByEmail={new Map()}
        canExploreMembers
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={async () => undefined}
        onRemoveAccess={async () => undefined}
      />
    );

    await screen.findByTestId('share-group-member-4');
    expect(mockGetWorkspaceGroupMembers).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state for a group without members', async () => {
    mockGetWorkspaceGroupMembers.mockResolvedValueOnce({ members: [] });

    renderGroupItem({ group: { ...sharedGroup, member_count: 0 } });

    fireEvent.click(screen.getByTestId(`share-group-toggle-${sharedGroup.group_id}`));

    expect(await screen.findByText('shareAction.noGroupMembers')).toBeTruthy();
  });

  it('collapses and reports an error when the roster fails to load', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetWorkspaceGroupMembers.mockRejectedValueOnce(new Error('boom'));

    renderGroupItem();

    const toggle = screen.getByTestId(`share-group-toggle-${sharedGroup.group_id}`);

    fireEvent.click(toggle);

    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('shareAction.loadGroupMembersFailed'));
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByTestId(`share-group-members-${sharedGroup.group_id}`)).toBeNull();

    consoleError.mockRestore();
  });
});
