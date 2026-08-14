import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { Role, WorkspaceGroup, WorkspaceMember } from '@/application/types';
import { MembersPanel } from '@/components/app/settings/MembersPanel';

import type { ReactNode } from 'react';

const mockGetMembers = jest.fn();
const mockGetWorkspaceGroups = jest.fn();
const mockCreateWorkspaceGroup = jest.fn();
const mockUpdateWorkspaceGroup = jest.fn();
const mockRemoveWorkspaceGroup = jest.fn();
const mockGetWorkspaceGroupMembers = jest.fn();
const mockAddWorkspaceGroupMember = jest.fn();
const mockRemoveWorkspaceGroupMember = jest.fn();
const mockTranslate = (key: string, values?: { count?: number }) => values?.count ?? key;
let mockCurrentWorkspaceId = 'workspace-1';

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
    inviteMembers: jest.fn(),
    removeMembers: jest.fn(),
    createInviteCode: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockCurrentWorkspaceId,
  useUserWorkspaceInfo: () => ({
    workspaces: [
      {
        id: 'workspace-1',
        role: Role.Owner,
        owner: { uid: 9007199254740991 },
      },
      {
        id: 'workspace-2',
        role: Role.Owner,
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
    mockGetMembers.mockResolvedValue([workspaceMember]);
    mockGetWorkspaceGroups.mockResolvedValue({ groups: [group] });
    mockCreateWorkspaceGroup.mockResolvedValue(group);
    mockUpdateWorkspaceGroup.mockResolvedValue(group);
    mockRemoveWorkspaceGroup.mockResolvedValue(undefined);
    mockGetWorkspaceGroupMembers.mockResolvedValue({ members: [] });
    mockAddWorkspaceGroupMember.mockResolvedValue({ uid: workspaceMember.uid });
    mockRemoveWorkspaceGroupMember.mockResolvedValue(undefined);
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
