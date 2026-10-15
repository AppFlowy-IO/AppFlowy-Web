import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { PlainError } from '@/application/errors/plain-error';
import { WorkspaceGroup } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';

import { GroupSpaceCoverageCard, GroupSpaceCoverageSummary } from '../GroupSpaceCoverageControl';

const groupId = '12345678-1234-4123-8123-123456789abc';
const mockSave = jest.fn();
const mockRead = jest.fn();
const emitter = new EventEmitter();

// Escape interpolated values the way i18next does unless a caller opts out.
const escapeLikeI18next = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { group?: string; reason?: string; count?: number; interpolation?: { escapeValue?: boolean } }
    ) => {
      const raw = options?.interpolation?.escapeValue === false;

      if (options?.group !== undefined) {
        const group = raw ? options.group : escapeLikeI18next(options.group);

        return options.reason !== undefined ? `${key}:${group}:${options.reason}` : `${key}:${group}`;
      }

      if (options?.count !== undefined) return `${key}:${options.count}`;
      return key;
    },
  }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getWorkspaceGroups: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('@/application/services/js-services/http/group-space-coverage-api', () => ({
  isGroupSpaceCoverageLevel: (value: unknown) => value === null || value === 10 || value === 30,
  setGroupSpaceCoverage: (...args: unknown[]) => mockSave(...args),
}));
// Flatten the menu like the other access-dropdown tests so options are directly clickable.
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
    <button data-testid={testId} type='button' onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => <span>selected</span>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const toastSuccess = jest.mocked(toast.success);
const toastError = jest.mocked(toast.error);

function group(overrides: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
  return {
    group_id: groupId,
    name: 'Directory group',
    member_count: 12,
    source: 'scim',
    space_coverage_supported: true,
    can_manage_space_coverage: true,
    space_coverage_access_level: null,
    ...overrides,
  };
}

function trigger() {
  return screen.getByTestId('group-space-coverage-trigger');
}

function option(level: 'off' | '10' | '30') {
  return screen.getByTestId(`group-space-coverage-option-${level}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  emitter.removeAllListeners();
  mockSave.mockImplementation(async (_workspace, _group, level) => ({ access_level: level }));
});

describe('group access to all spaces (group dialog)', () => {
  it('asks before giving a group access and saves only after confirmation', async () => {
    const onChanged = jest.fn();

    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group()} onChanged={onChanged} />);
    expect(trigger().textContent).toContain('groupSpaceAccess.off');
    fireEvent.click(option('10'));
    const confirmation = await screen.findByTestId('group-space-coverage-confirmation');

    expect(within(confirmation).getByText('groupSpaceAccess.confirmTitle:Directory group')).toBeTruthy();
    expect(within(confirmation).getByText('groupSpaceAccess.confirmView:Directory group')).toBeTruthy();
    fireEvent.click(within(confirmation).getByTestId('group-space-coverage-cancel'));
    await waitFor(() => expect(screen.queryByTestId('group-space-coverage-confirmation')).toBeNull());
    expect(mockSave).not.toHaveBeenCalled();

    fireEvent.click(option('10'));
    fireEvent.click(await screen.findByTestId('group-space-coverage-confirm'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('workspace', groupId, 10, expect.any(Function)));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('groupSpaceAccess.updated'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
  });

  it('shows group names as typed in the confirmation', async () => {
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ name: 'R&D <EU>' })} />);
    fireEvent.click(option('30'));
    const confirmation = await screen.findByTestId('group-space-coverage-confirmation');

    expect(within(confirmation).getByText('groupSpaceAccess.confirmTitle:R&D <EU>')).toBeTruthy();
    expect(within(confirmation).getByText('groupSpaceAccess.confirmEdit:R&D <EU>')).toBeTruthy();
  });

  it('names the access button by its section and current level', () => {
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 10 })} />);
    expect(screen.getByRole('button', { name: 'groupSpaceAccess.title groupSpaceAccess.canView' })).toBe(trigger());
  });

  it('raising view to edit uses the edit wording', async () => {
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 10 })} />);
    fireEvent.click(option('30'));
    const confirmation = await screen.findByTestId('group-space-coverage-confirmation');

    expect(within(confirmation).getByText('groupSpaceAccess.confirmEdit:Directory group')).toBeTruthy();
    fireEvent.click(within(confirmation).getByTestId('group-space-coverage-confirm'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('workspace', groupId, 30, expect.any(Function)));
  });

  it('lowering or turning access off applies immediately with explicit null', async () => {
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 30 })} />);
    fireEvent.click(option('off'));
    expect(screen.queryByTestId('group-space-coverage-confirmation')).toBeNull();
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('workspace', groupId, null, expect.any(Function)));
    await waitFor(() => expect(trigger().textContent).toContain('groupSpaceAccess.off'));
    expect(toastSuccess).toHaveBeenCalledWith('groupSpaceAccess.updated');
  });

  it('shows the change as pending until the server confirms it', async () => {
    const save = deferred<{ access_level: number | null }>();

    mockSave.mockImplementationOnce(() => save.promise);
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 30 })} />);
    fireEvent.click(option('10'));
    await waitFor(() => expect(trigger().disabled).toBe(true));
    expect(trigger().getAttribute('aria-busy')).toBe('true');
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
    expect(toastSuccess).not.toHaveBeenCalled();
    await act(async () => save.resolve({ access_level: 10 }));
    expect(trigger().disabled).toBe(false);
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
    expect(toastSuccess).toHaveBeenCalledWith('groupSpaceAccess.updated');
  });

  it('a rejected save keeps the confirmed level and names the change, with a plain reason', async () => {
    mockSave.mockRejectedValueOnce({ code: 500, message: 'Server unavailable: pool timed out' });
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 30 })} />);
    fireEvent.click(option('off'));
    await waitFor(() =>
      // A server failure gets the shared catalog's words; its own text is never shown.
      expect(toastError).toHaveBeenCalledWith("groupSpaceAccess.updateFailed:Directory group:AppFlowy isn't available right now. Try again later.")
    );
    expect(trigger().textContent).toContain('groupSpaceAccess.canEdit');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['a lost right', { code: 1012, httpStatus: 403, message: 'user 42 cannot manage group 7' }, 'changeFailure.noPermission'],
    ['a deleted group', { code: -2, httpStatus: 404, message: 'Record not found: group 7' }, 'changeFailure.changedElsewhere'],
    // The service's own checks already speak plainly.
    ['a stale dialog', new PlainError('groupSpaceAccess.contextChanged'), 'groupSpaceAccess.contextChanged'],
    // A guard or library failure carries no reviewed copy, so its text is never shown.
    ['an unexpected client error', new TypeError("Cannot read properties of undefined (reading 'access_level')"),
      'changeFailure.unknown'],
  ])('says why a save was refused after %s, with the group name as typed', async (_case, error, reason) => {
    mockSave.mockRejectedValueOnce(error);
    render(
      <GroupSpaceCoverageCard workspaceId='workspace' group={group({ name: 'R&D <EU>', space_coverage_access_level: 10 })} />
    );
    fireEvent.click(option('off'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(`groupSpaceAccess.updateFailed:R&D <EU>:${reason}`));
    expect(String(toastError.mock.calls[0][0])).not.toMatch(/user 42|group 7|Record not found/);
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
  });

  it.each([
    [{ can_manage_space_coverage: false }, 'groupSpaceAccess.ownerRequired', 'groupSpaceAccess.off'],
    [{ space_coverage_access_level: 20 as never }, 'groupSpaceAccess.unknownHint', 'groupSpaceAccess.unknown'],
  ])('explains why the control is unavailable: %p', (patch, reason, label) => {
    render(<GroupSpaceCoverageCard workspaceId='workspace' group={group(patch)} />);
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent).toContain(label);
    expect(screen.getByTestId('group-space-coverage-reason').textContent).toBe(reason);
    fireEvent.click(option('30'));
    expect(screen.queryByTestId('group-space-coverage-confirmation')).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('does not report an error from a workspace that is no longer open', async () => {
    mockSave.mockRejectedValueOnce(new Error('Something changed while saving.'));
    render(
      <GroupSpaceCoverageCard
        workspaceId='workspace'
        group={group({ space_coverage_access_level: 10 })}
        isCurrent={() => false}
      />
    );
    fireEvent.click(option('off'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    await act(async () => undefined);
    expect(toastError).not.toHaveBeenCalled();
    expect(mockSave.mock.calls[0][3]()).toBe(false);
  });

  it('follows the group list when the level changed elsewhere', async () => {
    const { rerender } = render(<GroupSpaceCoverageCard workspaceId='workspace' group={group()} />);

    // Choosing the current level is a no-op.
    fireEvent.click(option('off'));
    expect(mockSave).not.toHaveBeenCalled();
    rerender(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 30 })} />);
    expect(trigger().textContent).toContain('groupSpaceAccess.canEdit');
  });

  it('after a save, follows every newer copy of the group, even one back at the old level', async () => {
    const { rerender } = render(<GroupSpaceCoverageCard workspaceId='workspace' group={group()} />);

    fireEvent.click(option('10'));
    fireEvent.click(await screen.findByTestId('group-space-coverage-confirm'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('groupSpaceAccess.updated'));
    // Until the list catches up, the confirmed save is shown.
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
    rerender(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: 10 })} />);
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
    // Another owner turns it off again.
    rerender(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: null })} />);
    expect(trigger().textContent).toContain('groupSpaceAccess.off');
    fireEvent.click(option('10'));
    expect(await screen.findByTestId('group-space-coverage-confirmation')).toBeTruthy();
  });

  it('keeps a confirmed save over a copy of the group that arrived while it was saving', async () => {
    const save = deferred<{ access_level: number | null }>();

    mockSave.mockImplementationOnce(() => save.promise);
    const { rerender } = render(<GroupSpaceCoverageCard workspaceId='workspace' group={group()} />);

    fireEvent.click(option('10'));
    fireEvent.click(await screen.findByTestId('group-space-coverage-confirm'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    // A list read that started before the save lands first, still saying Off.
    rerender(<GroupSpaceCoverageCard workspaceId='workspace' group={group({ space_coverage_access_level: null })} />);
    await act(async () => save.resolve({ access_level: 10 }));
    expect(trigger().textContent).toContain('groupSpaceAccess.canView');
  });
});

function Wrapper({ children }: { children: ReactNode }) {
  return <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>;
}

function mountSummary(onOpenGroups = jest.fn()) {
  return render(<GroupSpaceCoverageSummary workspaceId='workspace' onOpenGroups={onOpenGroups} />, {
    wrapper: Wrapper,
  });
}

describe('access to all spaces summary (Permissions panel)', () => {
  it('lists only groups with access and links to People > Groups', async () => {
    const onOpenGroups = jest.fn();

    mockRead.mockResolvedValue({
      groups: [
        group({ group_id: 'edit', name: 'Super_Users', space_coverage_access_level: 30 }),
        group({ group_id: 'none', name: 'Product', space_coverage_access_level: null }),
        group({ group_id: 'view', name: 'Codir', member_count: 4, space_coverage_access_level: 10 }),
      ],
    });
    mountSummary(onOpenGroups);
    const list = await screen.findByTestId('group-space-coverage-summary');

    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'CodirworkspacePermissions.groupMembers:4groupSpaceAccess.canView',
      'Super_UsersworkspacePermissions.groupMembers:12groupSpaceAccess.canEdit',
    ]);
    expect(screen.queryByText('Product')).toBeNull();
    // One short description; the Manage groups button is the way to change it.
    expect(screen.getByText('groupSpaceAccess.summaryDescription')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'groupSpaceAccess.manageGroups' }));
    expect(onOpenGroups).toHaveBeenCalledTimes(1);
  });

  it('shows a short empty state when no group has access', async () => {
    mockRead.mockResolvedValue({ groups: [group()] });
    mountSummary();
    expect(await screen.findByText('groupSpaceAccess.summaryEmpty')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'groupSpaceAccess.manageGroups' })).toBeTruthy();
  });

  it('an older server shows one unsupported line and no controls', async () => {
    mockRead.mockResolvedValue({
      groups: Array.from({ length: 30 }, (_, index) =>
        group({ group_id: `group-${index}`, space_coverage_supported: undefined, space_coverage_access_level: undefined })
      ),
    });
    mountSummary();
    expect(await screen.findAllByText('groupSpaceAccess.unsupported')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('a permission denial hides the section instead of reporting a connection problem', async () => {
    mockRead.mockRejectedValue({ code: 1012, httpStatus: 403, message: 'Not enough permissions' });
    const { container } = mountSummary();

    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('other failures offer a retry', async () => {
    mockRead.mockRejectedValueOnce({ code: -1, message: 'Network Error' });
    mockRead.mockResolvedValue({ groups: [group({ space_coverage_access_level: 10 })] });
    mountSummary();
    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toContain('groupSpaceAccess.loadFailed');
    fireEvent.click(within(alert).getByRole('button', { name: 'button.retry' }));
    expect(await screen.findByTestId('group-space-coverage-summary')).toBeTruthy();
  });

  it('revalidates in the background without blanking the list', async () => {
    mockRead.mockResolvedValueOnce({ groups: [group({ space_coverage_access_level: 10 })] });
    mountSummary();
    await screen.findByTestId('group-space-coverage-summary');
    const next = deferred<unknown>();

    mockRead.mockReturnValueOnce(next.promise);
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
    expect(screen.getByText('groupSpaceAccess.canView')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => next.resolve({ groups: [group({ space_coverage_access_level: 30 })] }));
    expect(await screen.findByText('groupSpaceAccess.canEdit')).toBeTruthy();
  });

  it('refreshes group access after the socket reconnects and removes its listener on unmount', async () => {
    mockRead.mockResolvedValueOnce({ groups: [group({ space_coverage_access_level: 10 })] });
    const { unmount } = mountSummary();

    await screen.findByText('groupSpaceAccess.canView');
    const next = deferred<unknown>();

    mockRead.mockReturnValueOnce(next.promise);
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CLOSED);
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.CONNECTING);
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
    });
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
    expect(screen.getByText('groupSpaceAccess.canView')).toBeTruthy();
    await act(async () => next.resolve({ groups: [group({ space_coverage_access_level: 30 })] }));
    expect(screen.getByText('groupSpaceAccess.canEdit')).toBeTruthy();
    expect(screen.queryByText('groupSpaceAccess.canView')).toBeNull();
    unmount();
    expect(emitter.listenerCount(APP_EVENTS.WEBSOCKET_STATUS)).toBe(0);
    act(() => {
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, WebSocket.OPEN);
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('a permission burst keeps one read active and one fresh follow-up', async () => {
    const first = deferred<unknown>();

    mockRead.mockReturnValueOnce(first.promise).mockResolvedValue({ groups: [group({ space_coverage_access_level: 30 })] });
    mountSummary();
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 20; index += 1) {
      await act(async () => {
        emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
      });
    }

    expect(mockRead).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ groups: [group({ space_coverage_access_level: 10 })] }));
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
    // The stale first answer is never shown; the follow-up wins.
    expect(await screen.findByText('groupSpaceAccess.canEdit')).toBeTruthy();
    expect(screen.queryByText('groupSpaceAccess.canView')).toBeNull();
  });

  it('unmount discards a queued read after the active one settles', async () => {
    const first = deferred<unknown>();

    mockRead.mockReturnValueOnce(first.promise);
    const { unmount } = mountSummary();

    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    await act(async () => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
    unmount();
    await act(async () => first.resolve({ groups: [group()] }));
    expect(mockRead).toHaveBeenCalledTimes(1);
  });
});
