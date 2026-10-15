import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { Role, WorkspaceGroup, WorkspaceMember } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { MembersPanel } from '@/components/app/settings/MembersPanel';

import type { ReactNode } from 'react';

const mockGetMembers = jest.fn();
const mockInviteMembers = jest.fn();
const mockGetWorkspaceGroups = jest.fn();
const mockCreateWorkspaceGroup = jest.fn();
const mockUpdateWorkspaceGroup = jest.fn();
const mockRemoveWorkspaceGroup = jest.fn();
const mockGetWorkspaceGroupMembers = jest.fn();
const mockAddWorkspaceGroupMember = jest.fn();
const mockRemoveWorkspaceGroupMember = jest.fn();
const mockSetGroupSpaceCoverage = jest.fn();
const mockTranslate = (key: string, values?: { count?: number }) => values?.count ?? key;
let mockCurrentWorkspaceId = 'workspace-1';
let mockWorkspaceRole = Role.Owner;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: {
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    getWorkspaceGroups: (...args: unknown[]) => mockGetWorkspaceGroups(...args),
    createWorkspaceGroup: (...args: unknown[]) => mockCreateWorkspaceGroup(...args),
    updateWorkspaceGroup: (...args: unknown[]) => mockUpdateWorkspaceGroup(...args),
    removeWorkspaceGroup: (...args: unknown[]) => mockRemoveWorkspaceGroup(...args),
    getWorkspaceGroupMembers: (...args: unknown[]) => mockGetWorkspaceGroupMembers(...args),
    addWorkspaceGroupMember: (...args: unknown[]) => mockAddWorkspaceGroupMember(...args),
    removeWorkspaceGroupMember: (...args: unknown[]) => mockRemoveWorkspaceGroupMember(...args),
    getInviteCode: jest.fn().mockResolvedValue({ code: null }),
    inviteMembers: (...args: unknown[]) => mockInviteMembers(...args),
    removeMembers: jest.fn(),
    createInviteCode: jest.fn(),
  },
}));

jest.mock('@/application/services/js-services/http/group-space-coverage-api', () => ({
  isGroupSpaceCoverageLevel: (value: unknown) => value === null || value === 10 || value === 30,
  setGroupSpaceCoverage: (...args: unknown[]) => mockSetGroupSpaceCoverage(...args),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockCurrentWorkspaceId,
  useUserWorkspaceInfo: () => ({
    workspaces: [
      {
        id: 'workspace-1',
        role: mockWorkspaceRole,
        owner: { uid: 9007199254740991 },
      },
      {
        id: 'workspace-2',
        role: mockWorkspaceRole,
        owner: { uid: 9007199254740991 },
      },
    ],
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ uid: 'different-owner-id' }),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type='button' onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => <span>selected</span>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/tabs', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const TabsContext = React.createContext<{ value: string; setValue: (value: string) => void } | null>(null);

  return {
    Tabs: ({
      children,
      value,
      onValueChange,
    }: {
      children: ReactNode;
      value: string;
      onValueChange: (value: string) => void;
    }) => <TabsContext.Provider value={{ value, setValue: onValueChange }}>{children}</TabsContext.Provider>,
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.useContext(TabsContext);

      return (
        <button type='button' role='tab' onClick={() => context?.setValue(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = React.useContext(TabsContext);

      return context?.value === value ? <div>{children}</div> : null;
    },
  };
});

const group: WorkspaceGroup = {
  group_id: 'group-1',
  name: 'Engineering',
  member_count: 0,
};

const workspaceMember: WorkspaceMember = {
  uid: 'member-1',
  name: 'Ada Lovelace',
  email: 'ada@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};

async function renderGroupsPanel() {
  render(<MembersPanel />);
  await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));
}

function groupRow() {
  return screen.getByTestId(`group-row-${group.group_id}`);
}

function groupEditButton() {
  return screen.getByTestId(`group-edit-${group.group_id}`);
}

describe('MembersPanel workspace group parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentWorkspaceId = 'workspace-1';
    mockWorkspaceRole = Role.Owner;
    mockGetMembers.mockResolvedValue([workspaceMember]);
    mockInviteMembers.mockResolvedValue(undefined);
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [group] });
    mockCreateWorkspaceGroup.mockResolvedValue(group);
    mockUpdateWorkspaceGroup.mockResolvedValue(group);
    mockRemoveWorkspaceGroup.mockResolvedValue(undefined);
    mockGetWorkspaceGroupMembers.mockResolvedValue({ members: [] });
    mockAddWorkspaceGroupMember.mockResolvedValue({ uid: workspaceMember.uid });
    mockRemoveWorkspaceGroupMember.mockResolvedValue(undefined);
    mockSetGroupSpaceCoverage.mockImplementation(async (_workspace, _group, level) => ({ access_level: level }));
  });

  it('opens straight on the Groups tab when another settings panel links to it', async () => {
    render(<MembersPanel initialTab='groups' />);
    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalled());

    expect(await screen.findByTestId('groups-table-header')).toBeTruthy();
    expect(screen.queryByTestId('members-table-header')).toBeNull();
  });

  it('configures access to all spaces in the General tab, also for directory-managed groups', async () => {
    const scimGroup: WorkspaceGroup = {
      ...group,
      name: 'Directory Engineering',
      source: 'scim',
      member_count: 1,
      space_coverage_supported: true,
      can_manage_space_coverage: true,
      space_coverage_access_level: null,
    };

    mockGetWorkspaceGroups.mockResolvedValue({ groups: [scimGroup] });
    await renderGroupsPanel();
    fireEvent.click(screen.getByTestId(`group-edit-${scimGroup.group_id}`));
    const modal = await screen.findByTestId('group-detail-modal');
    const card = within(modal).getByTestId('group-space-coverage-card');

    // The directory owns identity and membership, so only the AppFlowy setting is offered.
    expect(within(modal).getByRole('tab', { name: 'settings.appearance.people.generalTab' })).toBeTruthy();
    expect(within(modal).queryByTestId('group-detail-delete-button')).toBeNull();
    expect(within(card).getByTestId('group-space-coverage-trigger').textContent).toContain('groupSpaceAccess.off');
    const refreshesBeforeSave = mockGetWorkspaceGroups.mock.calls.length;

    fireEvent.click(within(card).getByRole('button', { name: 'groupSpaceAccess.canEdit' }));
    fireEvent.click(await screen.findByTestId('group-space-coverage-confirm'));
    await waitFor(() =>
      expect(mockSetGroupSpaceCoverage).toHaveBeenCalledWith('workspace-1', scimGroup.group_id, 30, expect.any(Function))
    );
    expect(mockSetGroupSpaceCoverage.mock.calls[0][3]()).toBe(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('groupSpaceAccess.updated'));
    await waitFor(() => expect(mockGetWorkspaceGroups.mock.calls.length).toBeGreaterThan(refreshesBeforeSave));
  });

  it('keeps the General tab for managed groups only when the server supports access to all spaces', async () => {
    const scimGroup: WorkspaceGroup = { ...group, name: 'Directory Engineering', source: 'scim', member_count: 1 };

    mockGetWorkspaceGroups.mockResolvedValue({ groups: [scimGroup] });
    await renderGroupsPanel();
    fireEvent.click(screen.getByTestId(`group-edit-${scimGroup.group_id}`));
    const modal = await screen.findByTestId('group-detail-modal');

    expect(within(modal).queryByRole('tab', { name: 'settings.appearance.people.generalTab' })).toBeNull();
    expect(within(modal).queryByTestId('group-space-coverage-card')).toBeNull();
  });

  it('shows access to all spaces above Delete group for groups created in AppFlowy', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({
      groups: [{ ...group, space_coverage_supported: true, can_manage_space_coverage: true, space_coverage_access_level: 10 }],
    });
    await renderGroupsPanel();
    fireEvent.click(groupEditButton());
    const modal = await screen.findByTestId('group-detail-modal');
    const card = within(modal).getByTestId('group-space-coverage-card');
    const deleteButton = within(modal).getByTestId('group-detail-delete-button');

    expect(within(card).getByTestId('group-space-coverage-trigger').textContent).toContain('groupSpaceAccess.canView');
    expect(card.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('links the People help action to the AppFlowy guide', async () => {
    await renderGroupsPanel();

    const learnMore = screen.getByRole('link', { name: 'workspace.learnMore' });

    expect(learnMore.getAttribute('href')).toBe('https://appflowy.com/guide/getting-started-with-appflowy');
    expect(learnMore.getAttribute('target')).toBe('_blank');
  });

  it('uses the Members table typography and spacing for group summaries', async () => {
    render(<MembersPanel />);
    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalled());

    const memberHeader = screen.getByTestId('members-table-header');
    const memberRow = screen.getByTestId(`members-row-${workspaceMember.email}`);

    fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));

    const groupHeader = screen.getByTestId('groups-table-header');
    const row = groupRow();
    const sharedHeaderClasses = [
      'grid',
      'gap-4',
      'border-b',
      'border-border-primary',
      'pb-2',
      'text-xs',
      'font-medium',
      'text-text-secondary',
    ];
    const sharedRowClasses = [
      'grid',
      'min-h-[60px]',
      'items-center',
      'gap-4',
      'border-b',
      'border-border-primary',
      'py-3',
      'text-sm',
    ];

    sharedHeaderClasses.forEach((className) => {
      expect(memberHeader.classList.contains(className)).toBe(true);
      expect(groupHeader.classList.contains(className)).toBe(true);
    });
    sharedRowClasses.forEach((className) => {
      expect(memberRow.classList.contains(className)).toBe(true);
      expect(row.classList.contains(className)).toBe(true);
    });
    expect(groupHeader.className).not.toContain('leading-[');
  });

  it('uses the Members table spacing for the empty Groups state', async () => {
    mockGetMembers.mockResolvedValueOnce([]);
    mockGetWorkspaceGroups.mockResolvedValueOnce({ groups: [] });

    render(<MembersPanel />);
    await waitFor(() => expect(screen.getByTestId('members-table-status')).toBeTruthy());
    const memberStatusClassName = screen.getByTestId('members-table-status').className;

    fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));

    expect(screen.getByTestId('groups-table-status').className).toBe(memberStatusClassName);
    expect(screen.getByTestId('groups-table-status').classList.contains('py-6')).toBe(true);
  });

  it('shows workspace group summaries without management controls to members', async () => {
    const memberVisibleGroup = { ...group, member_count: 1 };

    mockWorkspaceRole = Role.Member;
    mockGetWorkspaceGroups.mockResolvedValueOnce({ groups: [memberVisibleGroup] });

    await renderGroupsPanel();

    expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1');
    expect(screen.getByRole('tab', { name: 'settings.appearance.people.groupsTab 1' })).toBeTruthy();

    const row = screen.getByTestId(`group-row-${memberVisibleGroup.group_id}`);

    expect(within(row).getByText(memberVisibleGroup.name)).toBeTruthy();
    expect(within(row).getByText('1')).toBeTruthy();
    expect(screen.queryByTestId('people-create-group-button')).toBeNull();
    expect(screen.queryByTestId(`group-edit-${memberVisibleGroup.group_id}`)).toBeNull();
    expect(
      within(row).queryByRole('button', {
        name: `settings.appearance.people.groupActions ${memberVisibleGroup.name}`,
      })
    ).toBeNull();

    fireEvent.click(row);

    expect(screen.queryByTestId('group-detail-modal')).toBeNull();
    expect(mockGetWorkspaceGroupMembers).not.toHaveBeenCalled();
    expect(mockCreateWorkspaceGroup).not.toHaveBeenCalled();
    expect(mockUpdateWorkspaceGroup).not.toHaveBeenCalled();
    expect(mockRemoveWorkspaceGroup).not.toHaveBeenCalled();
  });

  it('does not request workspace group summaries for guests', async () => {
    mockWorkspaceRole = Role.Guest;

    render(<MembersPanel />);
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith('workspace-1', false));
    fireEvent.click(screen.getByRole('tab', { name: 'settings.appearance.people.groupsTab 0' }));

    expect(mockGetWorkspaceGroups).not.toHaveBeenCalled();
    expect(screen.getByText('settings.appearance.people.groupsOwnerOnly')).toBeTruthy();
    expect(screen.queryByTestId(`group-row-${group.group_id}`)).toBeNull();
    expect(screen.queryByTestId('people-create-group-button')).toBeNull();
  });

  it('renames a group through a modal instead of inline editing', async () => {
    await renderGroupsPanel();

    fireEvent.click(within(groupRow()).getByText('settings.appearance.people.renameGroup'));

    const modal = screen.getByTestId('rename-group-modal');
    const input = within(modal).getByTestId('people-rename-group-name-input');
    const submit = within(modal).getByTestId('people-rename-group-submit');

    expect((input as HTMLInputElement).value).toBe(group.name);
    expect(submit.getAttribute('aria-label')).toBe('button.confirm');
    fireEvent.change(input, { target: { value: 'Platform' } });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mockUpdateWorkspaceGroup).toHaveBeenCalledWith('workspace-1', group.group_id, { name: 'Platform' })
    );
  });

  it('requires confirmation before deleting from the group row menu', async () => {
    await renderGroupsPanel();

    fireEvent.click(within(groupRow()).getByText('settings.appearance.people.deleteGroup'));

    expect(mockRemoveWorkspaceGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('people-delete-group-confirm'));

    await waitFor(() => expect(mockRemoveWorkspaceGroup).toHaveBeenCalledWith('workspace-1', group.group_id));
  });

  it('opens group management from a quiet, visible edit action instead of the row', async () => {
    await renderGroupsPanel();

    expect(groupRow().className).not.toContain('cursor-pointer');
    expect(groupRow().className).not.toContain('hover:bg-');

    fireEvent.click(groupRow());
    expect(screen.queryByTestId('group-detail-modal')).toBeNull();

    fireEvent.click(groupEditButton());
    expect(await screen.findByTestId('group-detail-modal')).toBeTruthy();
  });

  it('keeps SCIM-managed groups visible while making identity and membership controls read-only', async () => {
    const scimGroup: WorkspaceGroup = {
      ...group,
      name: 'Directory Engineering',
      source: 'scim',
      member_count: 1,
    };
    const scimMember = {
      uid: workspaceMember.uid as string,
      email: workspaceMember.email,
      name: workspaceMember.name,
    };

    mockGetWorkspaceGroups.mockResolvedValueOnce({ groups: [scimGroup] });
    mockGetWorkspaceGroupMembers.mockResolvedValueOnce({ members: [scimMember] });
    await renderGroupsPanel();

    const row = screen.getByTestId(`group-row-${scimGroup.group_id}`);

    expect(within(row).queryByText('settings.appearance.people.renameGroup')).toBeNull();
    expect(within(row).queryByText('settings.appearance.people.deleteGroup')).toBeNull();
    expect(
      within(row).queryByRole('button', {
        name: `settings.appearance.people.groupActions ${scimGroup.name}`,
      })
    ).toBeNull();

    fireEvent.click(screen.getByTestId(`group-edit-${scimGroup.group_id}`));
    const memberRow = await screen.findByTestId(`group-member-row-${scimMember.uid}`);

    expect(screen.queryByTestId('group-detail-delete-button')).toBeNull();
    expect(screen.queryByTestId('workspace-member-inline-search-input')).toBeNull();
    expect(within(memberRow).queryByRole('button', { name: 'button.remove' })).toBeNull();
    expect(mockUpdateWorkspaceGroup).not.toHaveBeenCalled();
    expect(mockRemoveWorkspaceGroup).not.toHaveBeenCalled();
    expect(mockAddWorkspaceGroupMember).not.toHaveBeenCalled();
    expect(mockRemoveWorkspaceGroupMember).not.toHaveBeenCalled();
  });

  it('places Create Group beside the name and closes without creating by default', async () => {
    await renderGroupsPanel();

    fireEvent.click(screen.getByTestId('people-create-group-button'));

    const modal = screen.getByTestId('create-group-modal');
    const input = screen.getByTestId('people-create-group-name-input');
    const submit = screen.getByTestId('people-create-group-submit');

    expect(modal.className).toContain('w-[720px]');
    expect(modal.className).toContain('bg-surface-primary');
    expect(modal.className).toContain('rounded-500');
    expect(modal.className).toContain('shadow-dialog');
    expect(screen.getByTestId('workspace-group-icon-hero').getAttribute('class')).toContain('h-12');
    expect(screen.getByTestId('workspace-group-icon-name').className).toContain('rounded-400');
    expect(submit.className).toContain('w-[120px]');
    expect(submit.getAttribute('aria-label')).toBe('settings.appearance.people.createGroupAction');
    expect(input.parentElement).toBe(submit.parentElement);
    expect(input.nextElementSibling).toBe(submit);
    expect(screen.queryByTestId('people-create-group-cancel')).toBeNull();

    fireEvent.click(within(modal).getByRole('button', { name: 'button.close' }));

    expect(screen.queryByTestId('create-group-modal')).toBeNull();
    expect(mockCreateWorkspaceGroup).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting from group management and supports cancel', async () => {
    await renderGroupsPanel();

    fireEvent.click(groupEditButton());
    const detailModal = await screen.findByTestId('group-detail-modal');

    expect(detailModal.className).toContain('w-[720px]');
    expect(detailModal.className).toContain('bg-surface-primary');
    expect(screen.getByTestId('workspace-group-icon-detail').className).toContain('h-16');
    fireEvent.click(screen.getByTestId('group-detail-delete-button'));

    let confirmation = screen.getByTestId('delete-group-confirmation');

    expect(confirmation.className).toContain('w-[440px]');
    expect(confirmation.className).toContain('rounded-400');
    expect(within(confirmation).getByRole('button', { name: 'button.close' })).toBeTruthy();
    expect(mockRemoveWorkspaceGroup).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByTestId('modal-cancel'));
    expect(screen.queryByTestId('delete-group-confirmation')).toBeNull();
    expect(screen.getByTestId('group-detail-modal')).toBeTruthy();
    expect(mockRemoveWorkspaceGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('group-detail-delete-button'));
    confirmation = screen.getByTestId('delete-group-confirmation');
    fireEvent.click(within(confirmation).getByTestId('people-delete-group-confirm'));

    await waitFor(() => expect(mockRemoveWorkspaceGroup).toHaveBeenCalledWith('workspace-1', group.group_id));
  });

  it('rolls back a new group when an initial member cannot be added', async () => {
    mockAddWorkspaceGroupMember.mockRejectedValueOnce(new Error('add failed'));
    await renderGroupsPanel();

    fireEvent.click(screen.getByTestId('people-create-group-button'));
    fireEvent.change(screen.getByTestId('people-create-group-name-input'), { target: { value: 'Platform' } });
    fireEvent.change(screen.getByTestId('create-group-member-search-input'), { target: { value: 'Ada' } });
    fireEvent.click(await screen.findByTestId('create-group-member-search-result'));
    fireEvent.click(screen.getByTestId('people-create-group-submit'));

    await waitFor(() => expect(mockRemoveWorkspaceGroup).toHaveBeenCalledWith('workspace-1', group.group_id));
    expect(screen.getByTestId('create-group-modal')).toBeTruthy();
  });

  it('rolls back all initial members when group creation reaches the server limit', async () => {
    const members: WorkspaceMember[] = Array.from({ length: 4 }, (_, index) => ({
      ...workspaceMember,
      uid: `selected-${index}`,
      name: `Selected Member ${index}`,
      email: `selected-${index}@appflowy.io`,
    }));
    const message = 'Workspace groups can contain at most 2 members';

    mockGetMembers.mockResolvedValue(members);
    mockAddWorkspaceGroupMember
      .mockResolvedValueOnce({ uid: members[0].uid })
      .mockResolvedValueOnce({ uid: members[1].uid })
      .mockRejectedValueOnce(new Error(message));
    await renderGroupsPanel();

    fireEvent.click(screen.getByTestId('people-create-group-button'));
    fireEvent.change(screen.getByTestId('people-create-group-name-input'), { target: { value: 'Platform' } });
    for (const member of members) {
      fireEvent.change(screen.getByTestId('create-group-member-search-input'), { target: { value: member.email } });
      fireEvent.click(await screen.findByTestId('create-group-member-search-result'));
    }

    fireEvent.click(screen.getByTestId('people-create-group-submit'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.appearance.people.addGroupMemberFailed'));
    expect(mockCreateWorkspaceGroup).toHaveBeenCalledWith('workspace-1', { name: 'Platform' });
    expect(mockAddWorkspaceGroupMember).toHaveBeenCalledTimes(3);
    members.slice(0, 3).forEach((member, index) => {
      expect(mockAddWorkspaceGroupMember).toHaveBeenNthCalledWith(index + 1, 'workspace-1', group.group_id, {
        uid: member.uid,
      });
    });
    expect(mockRemoveWorkspaceGroup).toHaveBeenCalledTimes(1);
    expect(mockRemoveWorkspaceGroup).toHaveBeenCalledWith('workspace-1', group.group_id);
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();

    const modal = screen.getByTestId('create-group-modal');
    const selectedMembers = within(modal).getByTestId('create-group-member-picker');

    expect(within(modal).getByTestId<HTMLInputElement>('people-create-group-name-input').value).toBe('Platform');
    for (const member of members) {
      expect(within(selectedMembers).getByText(member.name)).toBeTruthy();
    }

    expect(screen.getByTestId<HTMLButtonElement>('people-create-group-submit').disabled).toBe(false);
  });

  it.each([2, 20])('preserves an existing full group when the server rejects its %i-member limit', async (limit) => {
    const currentMembers = Array.from({ length: limit }, (_, index) => ({
      uid: `existing-${index}`,
      name: `Existing Member ${index}`,
      email: `existing-${index}@appflowy.io`,
    }));
    const message = `Workspace groups can contain at most ${limit} members`;

    mockGetWorkspaceGroups.mockResolvedValue({ groups: [{ ...group, member_count: limit }] });
    mockGetWorkspaceGroupMembers.mockResolvedValue({ members: currentMembers });
    mockAddWorkspaceGroupMember.mockRejectedValueOnce(new Error(message));
    await renderGroupsPanel();

    fireEvent.click(groupEditButton());
    const modal = await screen.findByTestId('group-detail-modal');

    fireEvent.click(within(modal).getByRole('tab', { name: 'settings.appearance.people.membersTab' }));
    expect(await within(modal).findAllByTestId(/^group-member-row-/)).toHaveLength(limit);
    const input = within(modal).getByTestId<HTMLInputElement>('workspace-member-inline-search-input');

    fireEvent.change(input, { target: { value: workspaceMember.email } });
    fireEvent.click(within(modal).getByRole('button', { name: /settings\.appearance\.people\.addUser/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.appearance.people.addGroupMemberFailed'));
    expect(mockAddWorkspaceGroupMember).toHaveBeenCalledTimes(1);
    expect(mockAddWorkspaceGroupMember).toHaveBeenCalledWith('workspace-1', group.group_id, { uid: workspaceMember.uid });
    expect(within(modal).getAllByTestId(/^group-member-row-/)).toHaveLength(limit);
    for (const member of currentMembers) {
      expect(within(modal).getByTestId(`group-member-row-${member.uid}`)).toBeTruthy();
    }

    expect(within(modal).queryByTestId(`group-member-row-${workspaceMember.uid}`)).toBeNull();
    expect(input.value).toBe(workspaceMember.email);
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('preserves a rejected eleven-email invitation batch and allows retrying with ten', async () => {
    const emails = Array.from({ length: 11 }, (_, index) => `invite-${index}@appflowy.io`);
    const message = 'A workspace invitation request can contain at most 10 email entries';

    mockInviteMembers.mockRejectedValueOnce(new Error(message));
    render(<MembersPanel />);
    await screen.findByTestId(`members-row-${workspaceMember.email}`);

    const input = screen.getByTestId<HTMLInputElement>('members-invite-email-input');
    const button = screen.getByTestId('members-invite-button');

    fireEvent.change(input, { target: { value: emails.join(', ') } });
    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong. Contact support if this keeps happening.'));
    expect(mockInviteMembers).toHaveBeenCalledTimes(1);
    expect(mockInviteMembers).toHaveBeenNthCalledWith(1, 'workspace-1', emails);
    expect(input.value).toBe(emails.join(', '));
    expect(mockGetMembers).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId(/^members-row-/)).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: emails.slice(0, 10).join(', ') } });
    fireEvent.click(button);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('inviteMember.inviteSuccess'));
    expect(mockInviteMembers).toHaveBeenCalledTimes(2);
    expect(mockInviteMembers).toHaveBeenNthCalledWith(2, 'workspace-1', emails.slice(0, 10));
    expect(input.value).toBe('');
    expect(mockGetMembers).toHaveBeenCalledTimes(2);
  });

  it.each(['button', 'enter'] as const)('adds the sole matching member with %s interaction', async (interaction) => {
    await renderGroupsPanel();

    fireEvent.click(groupEditButton());
    await waitFor(() => expect(mockGetWorkspaceGroupMembers).toHaveBeenCalledWith('workspace-1', group.group_id));

    const detailModal = screen.getByTestId('group-detail-modal');

    fireEvent.click(within(detailModal).getByRole('tab', { name: 'settings.appearance.people.membersTab' }));

    const input = await within(detailModal).findByTestId('workspace-member-inline-search-input');

    fireEvent.change(input, { target: { value: 'Ada' } });

    if (interaction === 'button') {
      fireEvent.click(within(detailModal).getByRole('button', { name: /settings\.appearance\.people\.addUser/ }));
    } else {
      fireEvent.keyDown(input, { key: 'Enter' });
    }

    await waitFor(() =>
      expect(mockAddWorkspaceGroupMember).toHaveBeenCalledWith('workspace-1', group.group_id, {
        uid: workspaceMember.uid,
      })
    );
  });

  it('ignores a post-mutation group refresh after switching workspaces', async () => {
    let resolveStaleRefresh!: (value: { groups: WorkspaceGroup[] }) => void;
    const staleRefresh = new Promise<{ groups: WorkspaceGroup[] }>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const secondWorkspaceGroup: WorkspaceGroup = {
      group_id: 'group-2',
      name: 'Design',
      member_count: 1,
    };

    mockGetWorkspaceGroups
      .mockResolvedValueOnce({ groups: [group] })
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValueOnce({ groups: [secondWorkspaceGroup] });

    const { rerender } = render(<MembersPanel />);

    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));
    fireEvent.click(within(groupRow()).getByText('settings.appearance.people.renameGroup'));
    fireEvent.change(screen.getByTestId('people-rename-group-name-input'), { target: { value: 'Platform' } });
    fireEvent.click(screen.getByTestId('people-rename-group-submit'));

    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(2));

    mockCurrentWorkspaceId = 'workspace-2';
    rerender(<MembersPanel />);

    fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));
    await waitFor(() => expect(screen.getByTestId(`group-row-${secondWorkspaceGroup.group_id}`)).toBeTruthy());

    resolveStaleRefresh({ groups: [{ ...group, name: 'Stale Engineering' }] });

    await staleRefresh;
    expect(screen.getByTestId(`group-row-${secondWorkspaceGroup.group_id}`)).toBeTruthy();
    expect(screen.queryByText('Stale Engineering')).toBeNull();
  });

  it.each(['detail', 'rename', 'delete', 'create', 'search'] as const)(
    'resets the open %s group UI when switching workspaces',
    async (openUi) => {
      const secondWorkspaceGroup: WorkspaceGroup = {
        group_id: 'group-2',
        name: 'Design',
        member_count: 1,
      };

      mockGetWorkspaceGroups.mockImplementation(async (workspaceId: string) => ({
        groups: workspaceId === 'workspace-1' ? [group] : [secondWorkspaceGroup],
      }));

      const { rerender } = render(<MembersPanel />);

      await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-1'));
      fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));

      if (openUi === 'detail') {
        fireEvent.click(groupEditButton());
        expect(await screen.findByTestId('group-detail-modal')).toBeTruthy();
      } else if (openUi === 'rename') {
        fireEvent.click(within(groupRow()).getByText('settings.appearance.people.renameGroup'));
        expect(screen.getByTestId('rename-group-modal')).toBeTruthy();
      } else if (openUi === 'delete') {
        fireEvent.click(within(groupRow()).getByText('settings.appearance.people.deleteGroup'));
        expect(screen.getByTestId('delete-group-confirmation')).toBeTruthy();
      } else if (openUi === 'create') {
        fireEvent.click(screen.getByTestId('people-create-group-button'));
        expect(screen.getByTestId('create-group-modal')).toBeTruthy();
      } else {
        fireEvent.click(screen.getByTestId('people-groups-open-search-button'));
        fireEvent.change(screen.getByPlaceholderText('settings.appearance.people.searchGroupsByName'), {
          target: { value: 'Engineering' },
        });
      }

      mockCurrentWorkspaceId = 'workspace-2';
      rerender(<MembersPanel />);

      await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledWith('workspace-2'));
      expect(screen.queryByTestId('group-detail-modal')).toBeNull();
      expect(screen.queryByTestId('rename-group-modal')).toBeNull();
      expect(screen.queryByTestId('delete-group-confirmation')).toBeNull();
      expect(screen.queryByTestId('create-group-modal')).toBeNull();
      expect(screen.queryByPlaceholderText('settings.appearance.people.searchGroupsByName')).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));
      expect(await screen.findByTestId(`group-row-${secondWorkspaceGroup.group_id}`)).toBeTruthy();
      expect(screen.queryByTestId(`group-row-${group.group_id}`)).toBeNull();
    }
  );
});

describe('MembersPanel live group refresh', () => {
  const emitter = new EventEmitter();
  const hr = (level: WorkspaceGroup['space_coverage_access_level']): WorkspaceGroup => ({
    ...group,
    name: 'HR',
    member_count: 2,
    space_coverage_supported: true,
    can_manage_space_coverage: true,
    space_coverage_access_level: level,
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });

    return { promise, resolve, reject };
  }

  async function renderPanel() {
    render(
      <AppEventEmitterContext.Provider value={emitter}>
        <MembersPanel />
      </AppEventEmitterContext.Provider>
    );
    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('tab', { name: /groupsTab/ }).textContent).toContain('1'));
  }

  async function openGroupDialog() {
    await renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));
    fireEvent.click(groupEditButton());
    return screen.findByTestId('group-detail-modal');
  }

  function coverageTrigger() {
    return screen.getByTestId('group-space-coverage-trigger');
  }

  async function hint() {
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Drop queued one-off answers so a failing test can't feed the next one.
    mockGetWorkspaceGroups.mockReset();
    emitter.removeAllListeners();
    mockCurrentWorkspaceId = 'workspace-1';
    mockWorkspaceRole = Role.Owner;
    mockGetMembers.mockResolvedValue([workspaceMember]);
    mockGetWorkspaceGroupMembers.mockResolvedValue({ members: [] });
    mockSetGroupSpaceCoverage.mockImplementation(async (_workspace, _group, level) => ({ access_level: level }));
  });

  it('shows a change made by another owner in the open group dialog', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    const modal = await openGroupDialog();

    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.off');
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(30)] });
    await hint();
    await waitFor(() => expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canEdit'));

    // Turning access off is a real change again instead of a no-op on a stale value.
    fireEvent.click(within(modal).getByRole('button', { name: 'groupSpaceAccess.off' }));
    await waitFor(() =>
      expect(mockSetGroupSpaceCoverage).toHaveBeenCalledWith('workspace-1', group.group_id, null, expect.any(Function))
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('follows another owner who sets the level back after this owner saved it', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    const modal = await openGroupDialog();

    fireEvent.click(within(modal).getByRole('button', { name: 'groupSpaceAccess.canView' }));
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(10)] });
    fireEvent.click(await screen.findByTestId('group-space-coverage-confirm'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('groupSpaceAccess.updated'));
    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(2));
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canView');

    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    await hint();
    await waitFor(() => expect(coverageTrigger().textContent).toContain('groupSpaceAccess.off'));
  });

  it.each([
    ['window focus', () => window.dispatchEvent(new Event('focus'))],
    ['coming back online', () => window.dispatchEvent(new Event('online'))],
    ['the browser tab becoming visible', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['a reconnected live connection', () => emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN)],
  ])('re-reads groups on %s while the Groups tab is open', async (_trigger, fire) => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    await renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /settings\.appearance\.people\.groupsTab/ }));
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [{ ...hr(null), name: 'Human Resources' }] });

    await act(async () => {
      fire();
    });
    expect(await screen.findByText('Human Resources')).toBeTruthy();
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(2);
  });

  it('does not re-read groups for permission changes while the Members tab is shown', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    await renderPanel();

    await hint();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog and rows on screen during and after a failed background refresh', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(10)] });
    await openGroupDialog();
    const read = deferred<{ groups: WorkspaceGroup[] }>();

    mockGetWorkspaceGroups.mockReturnValueOnce(read.promise);
    await hint();
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(2);
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canView');
    expect((coverageTrigger() as HTMLButtonElement).disabled).toBe(false);

    await act(async () => read.reject({ code: -1, message: 'Network Error' }));
    expect(screen.getByTestId('group-detail-modal')).toBeTruthy();
    expect(screen.getByTestId(`group-row-${group.group_id}`)).toBeTruthy();
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canView');
    // A background refresh is not something the owner asked for, so it fails quietly.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('never shows an older read that finishes after newer changes were announced', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    await openGroupDialog();
    const slow = deferred<{ groups: WorkspaceGroup[] }>();
    const latest = deferred<{ groups: WorkspaceGroup[] }>();

    mockGetWorkspaceGroups.mockReturnValueOnce(slow.promise).mockReturnValueOnce(latest.promise);
    for (let index = 0; index < 5; index += 1) await hint();
    // One read at a time, plus one follow-up for everything announced meanwhile.
    expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(2);

    await act(async () => slow.resolve({ groups: [hr(30)] }));
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.off');
    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(3));
    await act(async () => latest.resolve({ groups: [hr(10)] }));
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canView');
  });

  it('never lets a background read that started before a save replace it', async () => {
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [hr(null)] });
    const modal = await openGroupDialog();
    const older = deferred<{ groups: WorkspaceGroup[] }>();
    const afterSave = deferred<{ groups: WorkspaceGroup[] }>();

    mockGetWorkspaceGroups.mockReturnValueOnce(older.promise).mockReturnValueOnce(afterSave.promise);
    await hint();
    fireEvent.click(within(modal).getByRole('button', { name: 'groupSpaceAccess.canView' }));
    fireEvent.click(await screen.findByTestId('group-space-coverage-confirm'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('groupSpaceAccess.updated'));

    // The read in flight still says Off; the save made it out of date.
    await act(async () => older.resolve({ groups: [hr(null)] }));
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canView');
    await waitFor(() => expect(mockGetWorkspaceGroups).toHaveBeenCalledTimes(3));
    await act(async () => afterSave.resolve({ groups: [hr(10)] }));
    expect(coverageTrigger().textContent).toContain('groupSpaceAccess.canView');
  });

  it('still reports a failed first load', async () => {
    mockGetWorkspaceGroups.mockRejectedValue({ code: -1, message: 'Network Error' });
    render(
      <AppEventEmitterContext.Provider value={emitter}>
        <MembersPanel initialTab='groups' />
      </AppEventEmitterContext.Provider>
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network Error'));
  });
});
