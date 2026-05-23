import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

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
    isYou: false,
    onAccessLevelChange: async () => undefined,
    onRemoveAccess: async () => undefined,
    person: createPerson(),
    ...overrides,
  };

  return render(<AccessLevelDropdown {...props} />);
}

describe('AccessLevelDropdown', () => {
  it('keeps full-access collaborators editable for users who can modify access', () => {
    renderAccessLevelDropdown();

    const trigger = screen.getByRole('button', { name: 'Full access' });

    expect(trigger.disabled).toBe(false);
    expect(screen.getByText('Can view')).toBeTruthy();
    expect(screen.getByText('Can edit')).toBeTruthy();
    expect(screen.getAllByText('Full access')).toHaveLength(2);
    expect(screen.getByText('Remove access')).toBeTruthy();
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
});
