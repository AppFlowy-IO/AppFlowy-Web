import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, IPeopleWithAccessType, Role } from '@/application/types';

import { AccessLevelDropdown } from '../AccessLevelDropdown';

import type { ComponentProps, ReactNode } from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'shareAction.canEdit': 'Can edit',
        'shareAction.canEditDescription': 'Can make any changes',
        'shareAction.canView': 'Can view',
        'shareAction.canViewDescription': "Can't make changes",
        'shareAction.fullAccess': 'Full access',
        'shareAction.fullAccessDescription': 'Can edit and share with others',
        'shareAction.readAndWrite': 'Can edit',
        'shareAction.readOnly': 'Can view',
        'shareAction.removeAccess': 'Remove access',
      };

      return translations[key] ?? key;
    },
  }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/components/app/share/RemoveAccessConfirmDialog', () => ({
  RemoveAccessConfirmDialog: ({ open }: { open: boolean }) => (open ? <div>remove access dialog</div> : null),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role='menu'>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button
      disabled={disabled}
      role='menuitem'
      type='button'
      onClick={() => onSelect?.({ preventDefault: () => undefined })}
    >
      {children}
    </button>
  ),
  DropdownMenuItemTick: () => <span data-testid='dropdown-menu-item-tick' />,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const createPerson = (overrides: Partial<IPeopleWithAccessType> = {}): IPeopleWithAccessType => ({
  access_level: AccessLevel.FullAccess,
  avatar_url: '',
  email: 'collaborator@appflowy.local',
  name: 'Collaborator',
  pending_invitation: false,
  role: Role.Member,
  ...overrides,
});

function renderAccessLevelDropdown(overrides: Partial<ComponentProps<typeof AccessLevelDropdown>> = {}) {
  const props: ComponentProps<typeof AccessLevelDropdown> = {
    canModify: true,
    currentUserHasFullAccess: true,
    currentUserCanGrantFullAccess: false,
    isYou: false,
    onAccessLevelChange: async () => undefined,
    onRemoveAccess: async () => undefined,
    person: createPerson(),
    ...overrides,
  };

  return render(<AccessLevelDropdown {...props} />);
}

describe('AccessLevelDropdown', () => {
  it('lets full-access users change, remove, or grant full access when allowed', () => {
    renderAccessLevelDropdown({
      currentUserCanGrantFullAccess: true,
    });

    const trigger = screen.getByRole('button', { name: 'Full access' });

    expect(trigger.disabled).toBe(false);
    expect(screen.getByText('Can view')).toBeTruthy();
    expect(screen.getByText('Can edit')).toBeTruthy();
    expect(screen.getAllByText('Full access')).toHaveLength(2);
    expect(screen.getByText('Can edit and share with others')).toBeTruthy();
    expect(screen.getByText('Remove access')).toBeTruthy();
  });

  it('shows full-access grants for workspace owners', () => {
    renderAccessLevelDropdown({
      currentUserCanGrantFullAccess: true,
      person: createPerson({ access_level: AccessLevel.ReadAndWrite }),
    });

    expect(screen.getByRole('button', { name: 'Can edit' }).disabled).toBe(false);
    expect(screen.getByText('Full access')).toBeTruthy();
    expect(screen.getByText('Can edit and share with others')).toBeTruthy();
  });

  it('keeps non-modifiable full-access rows as static labels', () => {
    renderAccessLevelDropdown({
      canModify: false,
      currentUserHasFullAccess: false,
    });

    expect(screen.queryByRole('button', { name: 'Full access' })).toBeNull();
    expect(screen.getByText('Full access')).toBeTruthy();
    expect(screen.queryByText('Remove access')).toBeNull();
  });

  it('keeps non-modifiable edit rows as static labels', () => {
    renderAccessLevelDropdown({
      canModify: false,
      currentUserHasFullAccess: false,
      person: createPerson({ access_level: AccessLevel.ReadAndWrite }),
    });

    expect(screen.queryByRole('button', { name: 'Can edit' })).toBeNull();
    expect(screen.getByText('Can edit')).toBeTruthy();
    expect(screen.queryByText('Remove access')).toBeNull();
  });

  it('keeps non-modifiable read-only rows as static labels', () => {
    renderAccessLevelDropdown({
      canModify: false,
      currentUserHasFullAccess: false,
      person: createPerson({ access_level: AccessLevel.ReadOnly }),
    });

    expect(screen.queryByRole('button', { name: 'Can view' })).toBeNull();
    expect(screen.getByText('Can view')).toBeTruthy();
    expect(screen.queryByText('Remove access')).toBeNull();
  });

  it('shows why database row-page permission changes are disabled', async () => {
    const disabledReason = 'Unable to change database row page permission.';

    renderAccessLevelDropdown({
      disabledReason,
      person: createPerson({ access_level: AccessLevel.ReadAndWrite }),
    });

    const disabledAccess = screen.getByTestId('access-level-change-disabled');

    expect(disabledAccess.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Can edit' })).toBeNull();
    expect(screen.queryByText('Remove access')).toBeNull();

    fireEvent.pointerMove(disabledAccess, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(disabledReason));
  });
});
