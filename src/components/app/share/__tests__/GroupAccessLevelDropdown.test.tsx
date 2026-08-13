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
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: (event: Event) => void }) => (
    <button type='button' onClick={() => onSelect?.(new Event('select'))}>
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

  it('reports a stronger inherited result instead of a successful downgrade', async () => {
    render(
      <GroupAccessLevelDropdown
        group={group}
        canModify
        currentUserHasFullAccess
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
        onAccessLevelChange={async () => undefined}
        onRemoveAccess={async () => null}
      />
    );

    fireEvent.click(screen.getByText('shareAction.canView'));

    await waitFor(() => expect(mockNotifySuccess).toHaveBeenCalledWith('shareAction.changeGroupAccessSuccess'));
    expect(mockNotifyError).not.toHaveBeenCalled();
  });
});
