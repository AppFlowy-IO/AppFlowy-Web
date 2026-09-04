import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, WorkspaceGroupViewPermission } from '@/application/types';
import { GroupAccessLevelDropdown } from '@/components/app/share/GroupAccessLevelDropdown';

import type { ReactNode } from 'react';

const mockNotifyError = jest.fn();
const mockNotifySuccess = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: (...args: unknown[]) => mockNotifyError(...args),
    success: (...args: unknown[]) => mockNotifySuccess(...args),
  },
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
  }) => (
    <button type='button' disabled={disabled} onClick={() => onSelect?.(new Event('select'))}>
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => null,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const group: WorkspaceGroupViewPermission = {
  group_id: 'group-1',
  name: 'Engineering',
  access_level: AccessLevel.ReadAndWrite,
  member_count: 3,
  source: 'direct',
};

describe('GroupAccessLevelDropdown', () => {
  beforeEach(() => {
    mockNotifyError.mockReset();
    mockNotifySuccess.mockReset();
  });

  it('assigns comment access without assigning edit access', async () => {
    const onAccessLevelChange = jest.fn(async () => AccessLevel.ReadAndComment);

    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={onAccessLevelChange}
        onRemoveAccess={async () => null}
      />
    );

    fireEvent.click(screen.getByText('shareAction.canComment'));

    await waitFor(() =>
      expect(onAccessLevelChange).toHaveBeenCalledWith(group.group_id, AccessLevel.ReadAndComment)
    );
    expect(onAccessLevelChange).not.toHaveBeenCalledWith(group.group_id, AccessLevel.ReadAndWrite);
  });

  it('reports a stronger inherited result instead of a successful downgrade', async () => {
    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={async () => AccessLevel.FullAccess}
        onRemoveAccess={async () => null}
      />
    );

    fireEvent.click(screen.getByText('shareAction.canView'));

    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('shareAction.groupAccessInheritedStronger'));
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('reports inherited access instead of claiming removal succeeded', async () => {
    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={async () => AccessLevel.ReadOnly}
        onRemoveAccess={async () => AccessLevel.ReadOnly}
      />
    );

    fireEvent.click(screen.getByText('shareAction.removeAccess'));

    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('shareAction.groupAccessStillInherited'));
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('does not invent inherited access when effective revalidation is unavailable', async () => {
    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={async () => undefined}
        onRemoveAccess={async () => null}
      />
    );

    fireEvent.click(screen.getByText('shareAction.canView'));

    await waitFor(() => expect(mockNotifySuccess).toHaveBeenCalledWith('shareAction.changeGroupAccessSuccess'));
    expect(mockNotifyError).not.toHaveBeenCalled();
  });

  it('serializes access changes and removal while a mutation is pending', async () => {
    let resolveAccessChange: (accessLevel: AccessLevel) => void = () => undefined;
    const onAccessLevelChange = jest.fn(
      () =>
        new Promise<AccessLevel>((resolve) => {
          resolveAccessChange = resolve;
        })
    );
    const onRemoveAccess = jest.fn(async () => null);

    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={onAccessLevelChange}
        onRemoveAccess={onRemoveAccess}
      />
    );

    fireEvent.click(screen.getByText('shareAction.canView'));

    expect(onAccessLevelChange).toHaveBeenCalledTimes(1);
    const editButton = screen.getByText('shareAction.canEdit').closest('button') as HTMLButtonElement;
    const removeButton = screen.getByText('shareAction.removeAccess').closest('button') as HTMLButtonElement;

    expect(editButton.disabled).toBe(true);
    expect(removeButton.disabled).toBe(true);

    fireEvent.click(editButton);
    fireEvent.click(removeButton);

    expect(onAccessLevelChange).toHaveBeenCalledTimes(1);
    expect(onRemoveAccess).not.toHaveBeenCalled();

    resolveAccessChange(AccessLevel.ReadOnly);
    await waitFor(() => expect(removeButton.disabled).toBe(false));

    fireEvent.click(removeButton);
    await waitFor(() => expect(onRemoveAccess).toHaveBeenCalledWith(group.group_id));
  });

  it('keeps lower-tier group mutations available without Full Access management authority', async () => {
    const onAccessLevelChange = jest.fn(async () => AccessLevel.ReadOnly);
    const onRemoveAccess = jest.fn(async () => null);

    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess={false}
        onAccessLevelChange={onAccessLevelChange}
        onRemoveAccess={onRemoveAccess}
      />
    );

    expect(screen.queryByText('shareAction.fullAccess')).toBeNull();
    expect(screen.getByText('shareAction.canView')).toBeTruthy();
    expect(screen.getByText('shareAction.canComment')).toBeTruthy();
    expect(screen.getByText('shareAction.canEdit')).toBeTruthy();
    expect(screen.getByText('shareAction.removeAccess')).toBeTruthy();

    fireEvent.click(screen.getByText('shareAction.canView'));
    await waitFor(() => expect(onAccessLevelChange).toHaveBeenCalledWith(group.group_id, AccessLevel.ReadOnly));

    fireEvent.click(screen.getByText('shareAction.removeAccess'));
    await waitFor(() => expect(onRemoveAccess).toHaveBeenCalledWith(group.group_id));
  });

  it('locks an existing Full Access group row without Full Access management authority', () => {
    const onAccessLevelChange = jest.fn(async () => AccessLevel.ReadOnly);
    const onRemoveAccess = jest.fn(async () => null);

    render(
      <GroupAccessLevelDropdown
        group={{ ...group, access_level: AccessLevel.FullAccess }}
        canModify
        currentUserHasFullAccess
        canManageFullAccess={false}
        onAccessLevelChange={onAccessLevelChange}
        onRemoveAccess={onRemoveAccess}
      />
    );

    expect(screen.getByText('shareAction.fullAccess')).toBeTruthy();
    expect(screen.queryByText('shareAction.canView')).toBeNull();
    expect(screen.queryByText('shareAction.removeAccess')).toBeNull();
    expect(onAccessLevelChange).not.toHaveBeenCalled();
    expect(onRemoveAccess).not.toHaveBeenCalled();
  });

  it('renders access as plain text when group mutations are not allowed', () => {
    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify={false}
        currentUserHasFullAccess
        canManageFullAccess={false}
        onAccessLevelChange={jest.fn(async () => AccessLevel.ReadOnly)}
        onRemoveAccess={jest.fn(async () => null)}
      />
    );

    expect(screen.getByText('shareAction.readAndWrite')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('shareAction.removeAccess')).toBeNull();
  });

  it('offers Full Access assignment to an owner-tier manager', () => {
    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
        canManageFullAccess
        onAccessLevelChange={async () => AccessLevel.FullAccess}
        onRemoveAccess={async () => null}
      />
    );

    expect(screen.getByText('shareAction.fullAccess')).toBeTruthy();
  });
});
