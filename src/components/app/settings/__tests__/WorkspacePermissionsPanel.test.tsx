import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { Role, WorkspaceMember } from '@/application/types';
import {
  SpaceCreatorSelection,
  SpaceCreatorSelections,
  WorkspaceSpaceCreationCapabilities,
} from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';

import { WorkspacePermissionsPanel } from '../WorkspacePermissionsPanel';

const workspaceId = '1053b770-ef6d-4e8f-8485-a795a359d13c';
const aliceId = 'cbde8f6b-7751-442b-9076-a2752f583be7';
const bobId = '6f1c0a52-3d4b-4c55-9e1e-4b7a1d2c3e4f';
const ginaId = '0b6e2d4f-8a9c-4e1f-a2b3-c4d5e6f70812';
const groupId = 'a9897632-edee-47e0-ae03-0996cc65d7a2';
const deletedGroupId = '2d1c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const emitter = new EventEmitter();
const mockRead = jest.fn();
const mockPolicy = jest.fn();
const mockList = jest.fn();
const mockMutate = jest.fn();
const mockMembers = jest.fn();
const mockGroups = jest.fn();
let current: WorkspaceSpaceCreationCapabilities;

// Escape interpolated values the way i18next does unless a caller opts out.
const escapeLikeI18next = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; count?: number; interpolation?: { escapeValue?: boolean } }) => {
      const raw = options?.interpolation?.escapeValue === false;

      if (options?.name !== undefined) return `${key}:${raw ? options.name : escapeLikeI18next(options.name)}`;
      if (options?.count !== undefined) return `${key}:${options.count}`;
      return key;
    },
  }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
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

const toastSuccess = jest.mocked(toast.success);
const toastError = jest.mocked(toast.error);

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

function member(overrides: Partial<WorkspaceMember>): WorkspaceMember {
  return { name: '', email: '', avatar_url: '', role: Role.Member, ...overrides };
}

const members: WorkspaceMember[] = [
  member({ user_uuid: aliceId, uid: '9007199254740993', name: 'Alice Martin', email: 'alice@acme.test' }),
  member({ user_uuid: bobId, name: 'Bob Stone', email: 'bob@acme.test' }),
  member({ user_uuid: ginaId, name: 'Gina Guest', email: 'gina@acme.test', role: Role.Guest }),
  member({ user_uuid: '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d', name: 'Olivia Owner', email: 'olivia@acme.test', role: Role.Owner }),
  member({
    user_uuid: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    name: 'Paul Pending',
    email: 'paul@acme.test',
    is_pending_invitation: true,
  }),
  member({ uid: '9007199254740995', name: 'Leo Legacy', email: 'leo@acme.test' }),
];

function row(type: 'user' | 'group', id: string, overrides: Partial<SpaceCreatorSelection> = {}): SpaceCreatorSelection {
  return {
    principal: { type, id },
    name: null,
    granted_by: aliceId,
    granted_at: '2026-10-11T12:00:00Z',
    revoked_at: null,
    eligible: true,
    ...overrides,
  };
}

function rosterOf(rows: SpaceCreatorSelection[]) {
  mockList.mockImplementation(
    async (_workspace: string, { kind }: { kind: 'user' | 'group' }): Promise<SpaceCreatorSelections> => ({
      selections: rows.filter((item) => item.principal.type === kind),
      next_cursor: null,
    })
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

function mount(onOpenGroups = jest.fn()) {
  return render(<WorkspacePermissionsPanel workspaceId={workspaceId} onOpenGroups={onOpenGroups} />, {
    wrapper: Wrapper,
  });
}

function policyCard(policy: string) {
  return screen.getByTestId(`space-creation-policy-${policy}`);
}

async function selections() {
  return screen.findByTestId('space-creator-selections');
}

function search(value: string) {
  fireEvent.change(screen.getByTestId('space-creator-search-input'), { target: { value } });
}

describe('workspace permission settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emitter.removeAllListeners();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
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
      current = { ...current, policy, revision: { ...current.revision, counter: String(Number(current.revision.counter) + 1) } };
    });
    rosterOf([]);
    mockMutate.mockResolvedValue({ changed: true, revision: { epoch: '1', counter: '2' } });
    mockMembers.mockResolvedValue(members);
    mockGroups.mockResolvedValue({
      groups: [
        {
          group_id: groupId,
          name: 'W_RH_edit',
          member_count: 3,
          space_coverage_supported: true,
          can_manage_space_coverage: true,
          space_coverage_access_level: null,
        },
      ],
    });
  });

  it('saves a policy from the option cards immediately and confirms it with a toast', async () => {
    const save = deferred<void>();

    mockPolicy.mockImplementationOnce(async (_workspace, policy) => {
      await save.promise;
      current = { ...current, policy, revision: { epoch: '1', counter: '2' } };
    });
    const { container } = mount();

    await screen.findByTestId('space-creation-policy-options');
    // The app's option cards replace native radios and selects.
    expect(container.querySelector('input[type="radio"], select')).toBeNull();
    expect(policyCard('owners_only').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(policyCard('owners_and_selected_members'));
    expect(mockPolicy).toHaveBeenCalledWith(workspaceId, 'owners_and_selected_members');
    // The chosen card is shown as pending right away, and the others are locked until it saves.
    expect(policyCard('owners_and_selected_members').getAttribute('aria-pressed')).toBe('true');
    expect((policyCard('members_and_owners') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => save.resolve());
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'workspacePermissions.policyUpdated',
        expect.objectContaining({ action: expect.objectContaining({ label: 'workspacePermissions.undo' }) })
      )
    );
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
    expect(policyCard('owners_and_selected_members').getAttribute('aria-pressed')).toBe('true');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'says that space creators keep their workspace role without needing a hover (owner=%s)',
    async (owner) => {
      current = { ...current, can_manage_space_creators: owner };
      mount();
      await screen.findByTestId('space-creation-policy-options');

      // Keyboard and screen reader users can't open a hover-only tooltip, so this must be page text.
      expect(screen.getByText('workspacePermissions.explanation').tagName).toBe('P');
    }
  );

  it('keeps the confirmed policy and reports a failed save', async () => {
    mockPolicy.mockRejectedValueOnce({ code: 1012, message: 'Only workspace owners can change this.' });
    mount();
    fireEvent.click(await screen.findByTestId('space-creation-policy-members_and_owners'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Only workspace owners can change this.'));
    expect(policyCard('owners_only').getAttribute('aria-pressed')).toBe('true');
    expect(policyCard('members_and_owners').getAttribute('aria-pressed')).toBe('false');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('undo in the policy toast restores the previous policy', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('space-creation-policy-members_and_owners'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const options = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } };

    await waitFor(() => expect(policyCard('members_and_owners').getAttribute('aria-pressed')).toBe('true'));
    await act(async () => options.action.onClick());
    await waitFor(() => expect(mockPolicy).toHaveBeenLastCalledWith(workspaceId, 'owners_only'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
    // Undoing an undo is not offered.
    expect(toastSuccess.mock.calls[1]).toEqual(['workspacePermissions.policyUpdated', undefined]);
    await waitFor(() => expect(policyCard('owners_only').getAttribute('aria-pressed')).toBe('true'));
  });

  it('shows only a saved-selection count while another mode is active', async () => {
    rosterOf([
      row('user', aliceId),
      row('user', bobId, { revoked_at: '2026-10-11T13:00:00Z' }),
      row('user', ginaId, { eligible: false }),
      row('group', groupId),
    ]);
    mount();
    expect(await screen.findByTestId('space-creator-saved-selections')).toBeTruthy();
    expect(screen.getByTestId('space-creator-saved-selections').textContent).toBe(
      'workspacePermissions.savedSelections:3'
    );
    expect(screen.queryByTestId('space-creator-selections')).toBeNull();
    expect(screen.queryByTestId('space-creator-search-input')).toBeNull();
    // The people directory is only needed once selected members can be managed.
    expect(mockMembers).not.toHaveBeenCalled();
  });

  it('lists current selections with names and emails, hides removed ones and never shows raw IDs', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([
      row('user', aliceId),
      row('user', bobId, { name: 'Bob Stone', revoked_at: '2026-10-11T13:00:00Z' }),
      row('user', ginaId, { name: 'Gina Guest', eligible: false }),
      row('group', groupId),
      row('group', deletedGroupId, { eligible: false }),
    ]);
    mount();
    const list = await selections();
    const alice = await within(list).findByTestId(`space-creator-row-user-${aliceId}`);

    await waitFor(() => expect(within(alice).getByText('Alice Martin')).toBeTruthy());
    expect(within(alice).getByText('alice@acme.test')).toBeTruthy();
    expect(within(list).queryByText('Bob Stone')).toBeNull();
    const gina = within(list).getByTestId(`space-creator-row-user-${ginaId}`);

    expect(within(gina).getByTestId('space-creator-not-eligible').textContent).toContain(
      'workspacePermissions.notEligibleHint'
    );
    const group = within(list).getByTestId(`space-creator-row-group-${groupId}`);

    expect(within(group).getByText('W_RH_edit')).toBeTruthy();
    expect(within(group).getByText('workspacePermissions.groupMembers:3')).toBeTruthy();
    const deleted = within(list).getByTestId(`space-creator-row-group-${deletedGroupId}`);

    expect(within(deleted).getByText('workspacePermissions.unknownGroup')).toBeTruthy();
    expect(within(deleted).getByTestId('space-creator-not-eligible').textContent).toContain(
      'workspacePermissions.groupNotEligibleHint'
    );
    expect(list.textContent).not.toMatch(UUID_PATTERN);
  });

  it('adds members and groups from inline results with one click', async () => {
    current.policy = 'owners_and_selected_members';
    mount();
    await selections();
    await waitFor(() => expect(mockMembers).toHaveBeenCalledWith(workspaceId));
    search('a');
    const results = await screen.findByTestId('space-creator-candidates');

    await within(results).findByText('Alice Martin');
    // Results are labelled so they read separately from the selected roster below.
    expect(within(results).getByText('workspacePermissions.notSelected')).toBeTruthy();
    expect(within(results).getByText('alice@acme.test')).toBeTruthy();
    // Guests, Owners, pending invitations and accounts without a stable ID are never offered.
    for (const name of ['Gina Guest', 'Olivia Owner', 'Paul Pending', 'Leo Legacy']) {
      expect(within(results).queryByText(name)).toBeNull();
    }

    fireEvent.click(within(results).getByRole('button', { name: 'workspacePermissions.addNamed:Alice Martin' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'user', id: aliceId }, true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('workspacePermissions.addedToast:Alice Martin'));
    expect(await screen.findByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
    expect((screen.getByTestId('space-creator-search-input')).value).toBe('');

    search('W_RH');
    const groupResult = await screen.findByTestId(`space-creator-candidate-group-${groupId}`);

    expect(within(groupResult).getByText('workspacePermissions.groupMembers:3')).toBeTruthy();
    fireEvent.click(within(groupResult).getByRole('button', { name: 'workspacePermissions.addNamed:W_RH_edit' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'group', id: groupId }, true));
    expect(await screen.findByTestId(`space-creator-row-group-${groupId}`)).toBeTruthy();
  });

  it('removes with an accessible icon button and offers undo', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([row('user', aliceId, { name: 'Alice Martin' })]);
    mount();
    const list = await selections();

    fireEvent.click(await within(list).findByRole('button', { name: 'workspacePermissions.removeNamed:Alice Martin' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'user', id: aliceId }, false));
    await waitFor(() => expect(screen.queryByTestId(`space-creator-row-user-${aliceId}`)).toBeNull());
    expect(toastSuccess).toHaveBeenCalledWith(
      'workspacePermissions.removedToast:Alice Martin',
      expect.objectContaining({ action: expect.objectContaining({ label: 'workspacePermissions.undo' }) })
    );
    const options = toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } };

    await act(async () => options.action.onClick());
    await waitFor(() => expect(mockMutate).toHaveBeenLastCalledWith(workspaceId, { type: 'user', id: aliceId }, true));
    expect(await screen.findByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
  });

  it('shows names with special characters as typed in actions and toasts', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([row('group', groupId, { name: 'R&D <EU>' })]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'workspacePermissions.removeNamed:R&D <EU>' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('workspacePermissions.removedToast:R&D <EU>', expect.anything())
    );
  });

  it('does not offer undo when a fresh grant would be refused', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([row('user', ginaId, { name: 'Gina Guest', eligible: false })]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'workspacePermissions.removeNamed:Gina Guest' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('workspacePermissions.removedToast:Gina Guest', undefined));
  });

  it('keeps the row and reports a failed removal with a toast instead of a misleading retry', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([row('user', aliceId, { name: 'Alice Martin' })]);
    mockMutate.mockRejectedValueOnce({ code: 1008, message: 'Selection is no longer eligible' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'workspacePermissions.removeNamed:Alice Martin' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Selection is no longer eligible'));
    expect(screen.getByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('keeps existing group selections removable without the group plan', async () => {
    current.policy = 'owners_and_selected_members';
    current.can_grant_creator_groups = false;
    rosterOf([row('group', groupId, { name: 'W_RH_edit' })]);
    mount();
    const list = await selections();

    expect(within(list).getByText('workspacePermissions.groupEntitlement')).toBeTruthy();
    expect(within(list).getByTestId('space-creator-search-input').getAttribute('placeholder')).toBe(
      'workspacePermissions.searchMembers'
    );
    await waitFor(() => expect(mockMembers).toHaveBeenCalled());
    search('W_RH');
    expect(await within(list).findByText('workspacePermissions.noMatches')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'workspacePermissions.removeNamed:W_RH_edit' }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(workspaceId, { type: 'group', id: groupId }, false));
    // Re-adding a group needs the plan, so undo is not offered.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('workspacePermissions.removedToast:W_RH_edit', undefined));
  });

  it('shows a non-owner the result without private rosters or group access requests', async () => {
    current.can_create_space = false;
    current.can_manage_space_creators = false;
    current.can_grant_creator_groups = false;
    mount();
    await screen.findByText('workspacePermissions.denied');
    expect(screen.getByText('workspacePermissions.ownerRequired')).toBeTruthy();
    for (const policy of ['members_and_owners', 'owners_only', 'owners_and_selected_members']) {
      expect((policyCard(policy) as HTMLButtonElement).disabled).toBe(true);
    }

    fireEvent.click(policyCard('members_and_owners'));
    expect(mockPolicy).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockMembers).not.toHaveBeenCalled();
    // Guests get 403 from the group directory; non-owners never ask for it here.
    expect(mockGroups).not.toHaveBeenCalled();
    expect(screen.queryByText('groupSpaceAccess.title')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps typed text and loaded rows through a background capability refresh', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([row('user', aliceId, { name: 'Alice Martin' })]);
    mount();
    await screen.findByTestId(`space-creator-row-user-${aliceId}`);
    await waitFor(() => expect(mockMembers).toHaveBeenCalledTimes(1));
    search('bo');
    await screen.findByTestId(`space-creator-candidate-user-${bobId}`);
    const listCalls = mockList.mock.calls.length;
    const refresh = deferred<WorkspaceSpaceCreationCapabilities>();

    mockRead.mockReturnValueOnce(refresh.promise);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.queryByText('workspacePermissions.loading')).toBeNull();
    expect((screen.getByTestId('space-creator-search-input')).value).toBe('bo');
    expect(screen.getByTestId(`space-creator-candidate-user-${bobId}`)).toBeTruthy();
    expect(screen.getByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
    await act(async () => refresh.resolve(current));
    expect((screen.getByTestId('space-creator-search-input')).value).toBe('bo');
    expect(screen.getByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
    // Same revision: nothing to re-read, and the directory is not fetched again.
    expect(mockList).toHaveBeenCalledTimes(listCalls);
    expect(mockMembers).toHaveBeenCalledTimes(1);
  });

  it('re-reads selections in the background after a permission revision', async () => {
    current.policy = 'owners_and_selected_members';
    rosterOf([row('user', aliceId, { name: 'Alice Martin' })]);
    mount();
    await screen.findByTestId(`space-creator-row-user-${aliceId}`);
    const page = deferred<SpaceCreatorSelections>();

    mockList.mockImplementation(async (_workspace: string, { kind }: { kind: 'user' | 'group' }) =>
      kind === 'user' ? page.promise : { selections: [], next_cursor: null }
    );
    current = { ...current, revision: { epoch: '1', counter: '5' } };
    await act(async () => {
      emitter.emit(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, { workspaceId, revision: current.revision });
    });
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(workspaceId, expect.objectContaining({ kind: 'user' })));
    // The previous rows stay while the new read is in flight.
    expect(screen.getByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
    expect(within(screen.getByTestId('space-creator-selections')).queryByRole('status')).toBeNull();
    await act(async () =>
      page.resolve({
        selections: [row('user', aliceId, { name: 'Alice Martin' }), row('user', bobId, { name: 'Bob Stone' })],
        next_cursor: null,
      })
    );
    expect(await screen.findByTestId(`space-creator-row-user-${bobId}`)).toBeTruthy();
  });

  it('reads every keyset page of selections', async () => {
    current.policy = 'owners_and_selected_members';
    mockList.mockImplementation(async (_workspace: string, query: { kind: string; after?: string }) => {
      if (query.kind === 'group') return { selections: [], next_cursor: null };
      return query.after === 'cursor-1'
        ? { selections: [row('user', bobId, { name: 'Bob Stone' })], next_cursor: null }
        : { selections: [row('user', aliceId, { name: 'Alice Martin' })], next_cursor: 'cursor-1' };
    });
    mount();
    expect(await screen.findByTestId(`space-creator-row-user-${aliceId}`)).toBeTruthy();
    expect(screen.getByTestId(`space-creator-row-user-${bobId}`)).toBeTruthy();
    expect(mockList).toHaveBeenCalledWith(workspaceId, { kind: 'user', after: undefined, limit: 200 });
    expect(mockList).toHaveBeenCalledWith(workspaceId, { kind: 'user', after: 'cursor-1', limit: 200 });
  });

  it('explains a failed first load and retries it', async () => {
    mockRead.mockRejectedValueOnce({ code: 500, httpStatus: 500, message: 'Internal error' });
    mount();
    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toContain('workspacePermissions.loadFailed');
    fireEvent.click(within(alert).getByRole('button', { name: 'button.retry' }));
    expect(await screen.findByTestId('space-creation-policy-options')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells an offline user to reconnect', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('workspacePermissions.offline');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('shows an old server as unsupported without an error or a dead-end action', async () => {
    mockRead.mockRejectedValue({ httpStatus: 404 });
    mount();
    const notice = await screen.findByText('workspacePermissions.unsupported');

    expect(notice.getAttribute('role')).toBe('status');
    expect(screen.queryByText('workspacePermissions.loading')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'button.retry' })).toBeNull();
  });

  it('gives roster and directory failures their own retry', async () => {
    current.policy = 'owners_and_selected_members';
    mockList.mockRejectedValueOnce({ code: 500, message: 'Roster failed' });
    mockMembers.mockRejectedValueOnce({ code: 500, message: 'Directory failed' });
    mount();
    const list = await selections();

    await within(list).findByText('workspacePermissions.selectionsError');
    await within(list).findByText('workspacePermissions.directoryError');
    const [directoryAlert, rosterAlert] = within(list).getAllByRole('alert');

    fireEvent.click(within(rosterAlert).getByRole('button', { name: 'button.retry' }));
    await waitFor(() => expect(within(list).queryByText('workspacePermissions.selectionsError')).toBeNull());
    expect(within(list).getByText('workspacePermissions.noSelections')).toBeTruthy();
    fireEvent.click(within(directoryAlert).getByRole('button', { name: 'button.retry' }));
    await waitFor(() => expect(within(list).queryByText('workspacePermissions.directoryError')).toBeNull());
    expect(mockMembers).toHaveBeenCalledTimes(2);
  });

  it('explains why choosing members is unavailable on an older server', async () => {
    current.selected_creators_supported = false;
    mount();
    const card = await screen.findByTestId('space-creation-policy-owners_and_selected_members');

    expect((card as HTMLButtonElement).disabled).toBe(true);
    expect(card.textContent).toContain('workspacePermissions.selectedUnsupported');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('keeps stale settings visible but paused after a failed refresh', async () => {
    mount();
    await screen.findByTestId('space-creation-policy-options');
    mockRead.mockRejectedValueOnce({ code: 500, message: 'Internal error' });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toContain('workspacePermissions.refreshFailed');
    expect(policyCard('owners_only').getAttribute('aria-pressed')).toBe('true');
    expect((policyCard('members_and_owners') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(alert).getByRole('button', { name: 'button.retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect((policyCard('members_and_owners') as HTMLButtonElement).disabled).toBe(false);
  });

  it('summarises access to all spaces for owners and links to People > Groups', async () => {
    const onOpenGroups = jest.fn();

    mockGroups.mockResolvedValue({
      groups: [
        {
          group_id: groupId,
          name: 'W_RH_edit',
          member_count: 3,
          space_coverage_supported: true,
          can_manage_space_coverage: true,
          space_coverage_access_level: 30,
        },
      ],
    });
    mount(onOpenGroups);
    const summary = await screen.findByTestId('group-space-coverage-summary');

    expect(within(summary).getByText('W_RH_edit')).toBeTruthy();
    expect(within(summary).getByText('groupSpaceAccess.canEdit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'groupSpaceAccess.manageGroups' }));
    expect(onOpenGroups).toHaveBeenCalledTimes(1);
  });
});
