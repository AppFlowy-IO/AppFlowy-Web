import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  AccessLevel,
  Role,
  SpaceInvitePolicy,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
  ViewLayout,
  WorkspaceMember,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import CreateSpaceModal from '@/components/app/view-actions/CreateSpaceModal';

import type { KeyboardEventHandler, ReactNode } from 'react';

const mockCreateSpace = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();
const mockGetMembers = jest.fn();
const mockGetSpacePermission = jest.fn();
const mockAddSpaceMember = jest.fn();
const mockMoveToTrash = jest.fn();
const mockDeleteTrash = jest.fn();

const candidateOne: WorkspaceMember = {
  uid: 'member-1',
  name: 'Annie',
  email: 'annie@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};
const candidateTwo: WorkspaceMember = {
  uid: 'member-2',
  name: 'Eva',
  email: 'eva@appflowy.io',
  avatar_url: '',
  role: Role.Member,
};

const customPermission: SpacePermissionSettings = {
  visibility: SpaceVisibility.Custom,
  owner_access_level: AccessLevel.FullAccess,
  member_default_access_level: AccessLevel.ReadAndWrite,
  everyone_else_access_level: AccessLevel.ReadOnly,
  invite_policy: SpaceInvitePolicy.OwnersOnly,
  sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
  invite_link_enabled: false,
  security: {
    disable_guests: false,
    disable_public_links: false,
    disable_export: false,
  },
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'space.defaultSpaceName' ? 'General' : key),
  }),
}));

jest.mock('@/application/services/domains', () => ({
  PageService: {
    moveToTrash: (...args: unknown[]) => mockMoveToTrash(...args),
    deleteTrash: (...args: unknown[]) => mockDeleteTrash(...args),
  },
  WorkspaceService: {
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    getSpacePermission: (...args: unknown[]) => mockGetSpacePermission(...args),
    addSpaceMember: (...args: unknown[]) => mockAddSpaceMember(...args),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    createSpace: mockCreateSpace,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
  }),
  useCurrentWorkspaceId: () => 'workspace-1',
  useUserWorkspaceInfo: () => ({
    userId: 'current-user',
    selectedWorkspace: { id: 'workspace-1', name: 'Acme', role: Role.Owner },
    workspaces: [{ id: 'workspace-1', name: 'Acme', role: Role.Owner }],
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({
    name: 'Nathan',
    email: 'nathan@appflowy.io',
    avatar: '',
  }),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onOk,
    onClose,
    title,
    okText,
    okButtonProps,
    PaperProps,
    showActions,
  }: {
    children: ReactNode;
    open: boolean;
    onOk?: () => void;
    onClose?: () => void;
    title: ReactNode;
    okText?: ReactNode;
    okButtonProps?: { disabled?: boolean; 'data-testid'?: string };
    PaperProps?: { 'data-testid'?: string };
    showActions?: boolean;
  }) =>
    open ? (
      <div
        data-testid={PaperProps?.['data-testid']}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOk?.();
        }}
      >
        <div data-testid='create-space-title'>{title}</div>
        <button data-testid='create-space-close' onClick={onClose}>
          close
        </button>
        {showActions && (
          <button
            data-testid={okButtonProps?.['data-testid'] ?? 'modal-ok-button'}
            disabled={okButtonProps?.disabled}
            onClick={onOk}
          >
            {okText}
          </button>
        )}
        {children}
      </div>
    ) : null,
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn() },
}));

jest.mock('@/components/app/share/WorkspaceMemberInlineSearch', () => ({
  getWorkspaceMemberUid: (member: WorkspaceMember) => member.uid || null,
  workspaceMemberDisplayName: (member: WorkspaceMember) => member.name || member.email,
  useAddableWorkspaceMembers: ({
    workspaceMembers,
    search,
    excludedUids,
  }: {
    workspaceMembers: WorkspaceMember[];
    search: string;
    excludedUids: Set<string>;
  }) => {
    const normalized = search.trim().toLowerCase();

    if (!normalized) return [];
    return workspaceMembers.filter(
      (member) =>
        !excludedUids.has(String(member.uid)) && `${member.name} ${member.email}`.toLowerCase().includes(normalized)
    );
  },
  WorkspaceMemberInlineSearch: ({
    search,
    onSearchChange,
    addableMembers,
    onAddMember,
    inputDisabled,
    onInputKeyDown,
  }: {
    search: string;
    onSearchChange: (value: string) => void;
    addableMembers: WorkspaceMember[];
    onAddMember: (member: WorkspaceMember) => void;
    inputDisabled?: boolean;
    onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  }) => (
    <div>
      <input
        data-testid='draft-member-search'
        value={search}
        disabled={inputDisabled}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={onInputKeyDown}
      />
      {addableMembers.map((member) => (
        <button
          key={String(member.uid)}
          data-testid={`draft-member-add-${member.uid}`}
          onClick={() => onAddMember(member)}
        >
          add {member.name}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('@/components/app/view-actions/SpaceIconButton', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (icon: string, color: string) => void }) => (
    <button data-testid='space-icon-button' onClick={() => onChange('star', '#ffbf00')}>
      icon
    </button>
  ),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    'data-testid': testId,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    'data-testid'?: string;
  }) => (
    <button data-testid={testId} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => <span>selected</span>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: () => <span data-testid='progress' />,
}));

jest.mock('@/components/ui/tabs', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const TabsContext = React.createContext({ value: '', onValueChange: (_value: string) => undefined });

  return {
    Tabs: ({
      children,
      onValueChange,
      value,
      ...props
    }: {
      children: ReactNode;
      onValueChange?: (value: string) => void;
      value: string;
      'data-testid'?: string;
    }) => (
      <TabsContext.Provider value={{ value, onValueChange: onValueChange ?? (() => undefined) }}>
        <div data-testid={props['data-testid']}>{children}</div>
      </TabsContext.Provider>
    ),
    TabsContent: ({ children, value }: { children: ReactNode; value: string }) => {
      const tabs = React.useContext(TabsContext);

      return tabs.value === value ? <div>{children}</div> : null;
    },
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, disabled, value }: { children: ReactNode; disabled?: boolean; value: string }) => {
      const tabs = React.useContext(TabsContext);

      return (
        <button
          role='tab'
          disabled={disabled}
          aria-selected={tabs.value === value}
          onClick={() => tabs.onValueChange(value)}
        >
          {children}
        </button>
      );
    },
  };
});

describe('CreateSpaceModal draft controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMembers.mockResolvedValue([candidateOne, candidateTwo]);
    mockGetSpacePermission.mockRejectedValue({ code: -2, httpStatus: 404, message: 'Space not found' });
    mockCreateSpace.mockResolvedValue('space-id');
    mockCreateSpaceWithInitialPage.mockResolvedValue({
      space: { view_id: 'space-id' },
      page: { view_id: 'page-id' },
    });
    mockAddSpaceMember.mockResolvedValue(undefined);
    mockMoveToTrash.mockResolvedValue(undefined);
    mockDeleteTrash.mockResolvedValue(undefined);
  });

  function visibilityOption(visibility: SpaceVisibility) {
    return screen.getByTestId(`manage-space-visibility-option-${visibility}`);
  }

  function enterSpaceName(name = 'General') {
    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: name } });
  }

  async function selectCustomAndAdd(member: WorkspaceMember) {
    enterSpaceName();
    fireEvent.click(visibilityOption(SpaceVisibility.Custom));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    fireEvent.change(screen.getByTestId('draft-member-search'), { target: { value: member.email } });
    fireEvent.click(await screen.findByTestId(`draft-member-add-${member.uid}`));
  }

  it('renders the shared Create Space panel and a deferred Create action', () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    expect(screen.getByTestId('space-settings-panel')).toBeTruthy();
    expect(screen.getByTestId('create-space-title').textContent).toBe('space.createSpace');
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
    expect(screen.getByTestId('space-name-input').value).toBe('');
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).not.toBeNull();
    expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }).getAttribute('disabled')).toBeNull();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it('keeps name, icon, access, type and member edits local until Create', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Launch plans' } });
    fireEvent.click(screen.getByTestId('space-icon-button'));
    fireEvent.click(visibilityOption(SpaceVisibility.Custom));
    fireEvent.click(screen.getByTestId(`manage-space-custom-members-access-option-${AccessLevel.ReadOnly}`));
    fireEvent.click(screen.getByTestId('manage-space-everyone-else-access-option-none'));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    fireEvent.change(screen.getByTestId('draft-member-search'), { target: { value: 'annie' } });
    fireEvent.click(await screen.findByTestId('draft-member-add-member-1'));

    expect(screen.getByTestId('create-space-draft-member-member-1')).toBeTruthy();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith({
        name: 'Launch plans',
        space_icon: 'star',
        space_icon_color: '#ffbf00',
        view_id: expect.any(String),
        client_generated_view_id: true,
        permission: {
          ...customPermission,
          member_default_access_level: AccessLevel.ReadOnly,
          everyone_else_access_level: null,
        },
      })
    );
    await waitFor(() =>
      expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', 'space-id', {
        uid: 'member-1',
        role: SpaceMemberRole.Member,
        access_level: AccessLevel.ReadOnly,
      })
    );
    expect(mockCreateSpace.mock.invocationCallOrder[0]).toBeLessThan(mockAddSpaceMember.mock.invocationCallOrder[0]);
  });

  it('does not submit Create when Enter is pressed in the draft member search', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(visibilityOption(SpaceVisibility.Custom));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith('workspace-1'));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    const search = screen.getByTestId('draft-member-search');

    fireEvent.change(search, { target: { value: candidateOne.email } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });

    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it.each([SpaceVisibility.Public, SpaceVisibility.Private])(
    'does not apply queued explicit members when the final type is %s',
    async (visibility) => {
      render(<CreateSpaceModal open onClose={jest.fn()} />);

      await selectCustomAndAdd(candidateOne);
      fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }));
      fireEvent.click(visibilityOption(visibility));
      fireEvent.click(screen.getByTestId('create-space-submit'));

      await waitFor(() => expect(mockCreateSpace).toHaveBeenCalledTimes(1));
      expect(mockCreateSpace).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: expect.objectContaining({ visibility }),
        })
      );
      expect(mockAddSpaceMember).not.toHaveBeenCalled();
    }
  );

  it('renders a Private owner-only card and locked current-user roster without draft writes', () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    expect(screen.getByTestId('manage-space-private-access-card').textContent).toContain(
      'space.permissionManager.privateAccessTitle'
    );
    expect(screen.getByTestId('manage-space-private-access-card').textContent).toContain(
      'space.permissionManager.privateOwnerDescription'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.membersTab' }));
    expect(screen.getByTestId('private-space-members-info').textContent).toBe(
      'space.permissionManager.privateMembersDescription'
    );
    const ownerRow = screen.getByTestId('private-space-owner-row');

    expect(ownerRow.textContent).toContain('Nathan');
    expect(ownerRow.textContent).toContain('space.permissionManager.workspaceOwner');
    expect(screen.getByTestId('private-space-owner-locked-role').textContent).toBe('space.permissionManager.owner');
    expect(within(ownerRow).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('draft-member-search')).toBeNull();
    expect(screen.queryByTestId('draft-add-member')).toBeNull();
    expect(mockGetMembers).not.toHaveBeenCalled();
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });

  it('uses the initial-page API only after Create and returns both committed IDs', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const initialPage = { layout: ViewLayout.Document, name: 'First page' };

    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} initialPage={initialPage} />);

    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() =>
      expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledWith({
        name: 'General',
        space_icon: '',
        space_icon_color: '',
        view_id: expect.any(String),
        client_generated_view_id: true,
        permission: {
          ...customPermission,
          visibility: SpaceVisibility.Public,
          everyone_else_access_level: null,
        },
        initial_page: { ...initialPage, view_id: expect.any(String) },
      })
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', 'page-id'));
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reopens with an empty fresh draft after creating a space from a persistent host', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const initialPage = { layout: ViewLayout.Document };
    const { rerender } = render(
      <CreateSpaceModal open onClose={onClose} onCreated={onCreated} initialPage={initialPage} />
    );

    enterSpaceName('Previously created space');
    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', 'page-id'));

    rerender(<CreateSpaceModal open={false} onClose={onClose} onCreated={onCreated} initialPage={initialPage} />);
    rerender(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} initialPage={initialPage} />);

    expect(screen.getByTestId('space-name-input').value).toBe('');
    expect(visibilityOption(SpaceVisibility.Public).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('create-space-submit').getAttribute('disabled')).not.toBeNull();
    expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(1);
  });

  it('preserves an edited Public access level in the structured creation payload', async () => {
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    enterSpaceName();
    fireEvent.click(screen.getByTestId(`manage-space-workspace-members-access-option-${AccessLevel.ReadOnly}`));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() =>
      expect(mockCreateSpace).toHaveBeenCalledWith({
        name: 'General',
        space_icon: '',
        space_icon_color: '',
        view_id: expect.any(String),
        client_generated_view_id: true,
        permission: {
          ...customPermission,
          visibility: SpaceVisibility.Public,
          member_default_access_level: AccessLevel.ReadOnly,
          everyone_else_access_level: null,
        },
      })
    );
  });

  it('guards duplicate Create clicks while the request is in flight', async () => {
    const creation = deferred<string>();

    mockCreateSpace.mockReturnValue(creation.promise);
    render(<CreateSpaceModal open onClose={jest.fn()} />);
    enterSpaceName();
    const submit = screen.getByTestId('create-space-submit');

    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);

    creation.resolve('space-id');
    await waitFor(() => expect(submit.getAttribute('disabled')).not.toBeNull());
    expect(screen.getByTestId('space-name-input').value).toBe('');
  });

  it('keeps an ambiguous create draft open, frozen, and retries with the same client-owned ID', async () => {
    mockCreateSpace.mockRejectedValueOnce(new Error('could not create space'));
    render(<CreateSpaceModal open onClose={jest.fn()} />);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('could not create space'));
    expect(screen.getByTestId('create-space-modal')).toBeTruthy();
    expect(screen.getByTestId('space-name-input').value).toBe('Keep this draft');
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.retry');
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);

    const firstAttemptId = mockCreateSpace.mock.calls[0][0].view_id;

    mockCreateSpace.mockResolvedValueOnce(firstAttemptId);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(mockCreateSpace).toHaveBeenCalledTimes(2));
    expect(mockCreateSpace.mock.calls[1][0].view_id).toBe(firstAttemptId);
  });

  it('keeps a definitively rejected standalone draft editable and cancellable without recovery requests', async () => {
    const onClose = jest.fn();

    mockCreateSpace.mockRejectedValueOnce({ code: 422, httpStatus: 422, message: 'invalid space name' });
    render(<CreateSpaceModal open onClose={onClose} />);

    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Rejected draft' } });
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('invalid space name'));
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
    fireEvent.click(screen.getByTestId('create-space-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockGetSpacePermission).not.toHaveBeenCalled();
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
  });

  it('hands off a committed standalone space and its queued roster when Close reconciles a lost response', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockResolvedValueOnce({ permission: customPermission });
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId, {
      uid: 'member-1',
      role: SpaceMemberRole.Member,
      access_level: AccessLevel.ReadAndWrite,
    });
    expect(mockAddSpaceMember.mock.invocationCallOrder[0]).toBeLessThan(onCreated.mock.invocationCallOrder[0]);
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('cleans the exact client-owned ID after reconciliation confirms a standalone 404', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockRejectedValueOnce({
      code: -2,
      httpStatus: 404,
      message: 'Space not found',
    });
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockGetSpacePermission).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(mockMoveToTrash).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(mockDeleteTrash).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', new Error('reconcile unavailable'), 'reconcile unavailable'],
    ['a 403', { httpStatus: 403, message: 'forbidden' }, 'forbidden'],
    ['a transient 503', { httpStatus: 503, message: 'service unavailable' }, 'service unavailable'],
  ])('preserves the frozen standalone draft when reconciliation returns %s', async (_case, error, message) => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockRejectedValueOnce(error);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(message));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockMoveToTrash).not.toHaveBeenCalled();
    expect(mockDeleteTrash).not.toHaveBeenCalled();
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();

    mockCreateSpace.mockResolvedValueOnce(clientOwnedSpaceId);
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(2);
    expect(mockCreateSpace.mock.calls[1][0].view_id).toBe(clientOwnedSpaceId);
  });

  it('retries the authoritative initial page on Close after composed cleanup could not be confirmed', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const cleanupFailed = Object.assign(new Error('response lost and cleanup unavailable'), {
      clientGeneratedCleanupSucceeded: false,
    });

    mockCreateSpaceWithInitialPage.mockRejectedValueOnce(cleanupFailed);
    render(
      <CreateSpaceModal
        open
        onClose={onClose}
        onCreated={onCreated}
        initialPage={{ layout: ViewLayout.Document, name: 'First page' }}
      />
    );

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost and cleanup unavailable'));
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();
    const firstPayload = mockCreateSpaceWithInitialPage.mock.calls[0][0];

    mockCreateSpaceWithInitialPage.mockResolvedValueOnce({
      space: { view_id: firstPayload.view_id },
      page: { view_id: firstPayload.initial_page.view_id },
    });
    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(firstPayload.view_id, firstPayload.initial_page.view_id));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(2);
    expect(mockCreateSpaceWithInitialPage.mock.calls[1][0].view_id).toBe(firstPayload.view_id);
    expect(mockCreateSpaceWithInitialPage.mock.calls[1][0].initial_page.view_id).toBe(firstPayload.initial_page.view_id);
    expect(mockCreateSpace).not.toHaveBeenCalled();
  });

  it('keeps the initial-page draft editable and rotates both IDs when composed cleanup was confirmed', async () => {
    const onClose = jest.fn();
    const cleanupSucceeded = Object.assign(new Error('initial page failed'), {
      clientGeneratedCleanupSucceeded: true,
    });

    mockCreateSpaceWithInitialPage.mockRejectedValueOnce(cleanupSucceeded);
    render(
      <CreateSpaceModal open onClose={onClose} initialPage={{ layout: ViewLayout.Document, name: 'First page' }} />
    );

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('initial page failed'));
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');
    const firstPayload = mockCreateSpaceWithInitialPage.mock.calls[0][0];

    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(2));
    const secondPayload = mockCreateSpaceWithInitialPage.mock.calls[1][0];

    expect(secondPayload.view_id).not.toBe(firstPayload.view_id);
    expect(secondPayload.initial_page.view_id).not.toBe(firstPayload.initial_page.view_id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unfreezes an ambiguous initial-page draft only after a retry confirms cleanup', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const cleanupUnconfirmed = Object.assign(new Error('response lost and cleanup unavailable'), {
      clientGeneratedCleanupSucceeded: false,
    });
    const cleanupConfirmed = Object.assign(new Error('initial page rejected and cleanup confirmed'), {
      clientGeneratedCleanupSucceeded: true,
    });

    mockCreateSpaceWithInitialPage.mockRejectedValueOnce(cleanupUnconfirmed).mockRejectedValueOnce(cleanupConfirmed);
    render(
      <CreateSpaceModal
        open
        onClose={onClose}
        onCreated={onCreated}
        initialPage={{ layout: ViewLayout.Document, name: 'First page' }}
      />
    );

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost and cleanup unavailable'));
    const firstPayload = mockCreateSpaceWithInitialPage.mock.calls[0][0];

    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.retry');

    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('initial page rejected and cleanup confirmed'));
    expect(mockCreateSpaceWithInitialPage.mock.calls[1][0].view_id).toBe(firstPayload.view_id);
    expect(mockCreateSpaceWithInitialPage.mock.calls[1][0].initial_page.view_id).toBe(
      firstPayload.initial_page.view_id
    );
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.create');

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockCreateSpaceWithInitialPage).toHaveBeenCalledTimes(2);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('keeps an earlier ambiguous ID and queued roster when a retry is definitively rejected without cleanup', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();
    const definitiveRetryRejection = { httpStatus: 422, message: 'validation rejected' };

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost')).mockRejectedValueOnce(definitiveRetryRejection);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('validation rejected'));
    expect(mockCreateSpace.mock.calls[1][0].view_id).toBe(clientOwnedSpaceId);
    expect(screen.getByTestId('draft-member-search').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.retry');

    mockGetSpacePermission.mockResolvedValueOnce({ permission: customPermission });
    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId, {
      uid: 'member-1',
      role: SpaceMemberRole.Member,
      access_level: AccessLevel.ReadAndWrite,
    });
    expect(mockCreateSpace).toHaveBeenCalledTimes(2);
  });

  it('closes after a confirmed standalone move even when permanent purge fails', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockDeleteTrash.mockRejectedValueOnce(new Error('delete unavailable'));
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    enterSpaceName();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockMoveToTrash).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(mockDeleteTrash).toHaveBeenCalledWith('workspace-1', clientOwnedSpaceId);
    expect(onCreated).not.toHaveBeenCalled();
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('does not let repeated Close bypass a pending roster after standalone reconciliation', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockCreateSpace.mockRejectedValueOnce(new Error('response lost'));
    mockGetSpacePermission.mockResolvedValueOnce({ permission: customPermission });
    mockAddSpaceMember.mockRejectedValueOnce(new Error('member add unavailable')).mockResolvedValueOnce(undefined);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('response lost'));
    const clientOwnedSpaceId = mockCreateSpace.mock.calls[0][0].view_id;

    fireEvent.click(screen.getByTestId('create-space-close'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockMoveToTrash).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(clientOwnedSpaceId, undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(2);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
  });

  it('retries a pending post-create roster on Close without recreating the committed space', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    mockAddSpaceMember.mockRejectedValueOnce(new Error('member add unavailable')).mockResolvedValueOnce(undefined);
    render(<CreateSpaceModal open onClose={onClose} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add unavailable'));
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('create-space-close'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember).toHaveBeenCalledTimes(2);
  });

  it('retries only pending member adds after creation has committed', async () => {
    const onCreated = jest.fn();

    mockAddSpaceMember.mockImplementation((_workspaceId: string, _spaceId: string, payload: { uid: string }) =>
      payload.uid === 'member-2' &&
      mockAddSpaceMember.mock.calls.filter((call) => call[2].uid === 'member-2').length === 1
        ? Promise.reject(new Error('member add failed'))
        : Promise.resolve()
    );
    render(<CreateSpaceModal open onClose={jest.fn()} onCreated={onCreated} />);

    await selectCustomAndAdd(candidateOne);
    fireEvent.change(screen.getByTestId('draft-member-search'), { target: { value: 'eva' } });
    fireEvent.click(await screen.findByTestId('draft-member-add-member-2'));
    fireEvent.click(screen.getByRole('tab', { name: 'space.permissionManager.generalTab' }));
    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('member add failed'));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('create-space-submit').textContent).toBe('button.retry');
    expect(screen.getByTestId('space-name-input').getAttribute('disabled')).not.toBeNull();

    fireEvent.click(screen.getByTestId('create-space-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('space-id', undefined));
    expect(mockCreateSpace).toHaveBeenCalledTimes(1);
    expect(mockAddSpaceMember.mock.calls.filter((call) => call[2].uid === 'member-1')).toHaveLength(1);
    expect(mockAddSpaceMember.mock.calls.filter((call) => call[2].uid === 'member-2')).toHaveLength(2);
  });

  it('cancels a draft without any mutation request', () => {
    const onClose = jest.fn();

    render(<CreateSpaceModal open onClose={onClose} />);
    fireEvent.change(screen.getByTestId('space-name-input'), { target: { value: 'Discard me' } });
    fireEvent.click(visibilityOption(SpaceVisibility.Private));
    fireEvent.click(screen.getByTestId('create-space-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCreateSpace).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
    expect(mockAddSpaceMember).not.toHaveBeenCalled();
  });
});
