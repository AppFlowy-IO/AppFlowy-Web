import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { AccessLevel, IPeopleWithAccessType, Role } from '@/application/types';

import { PersonItem } from '../PersonItem';

import type { ComponentProps, ReactNode } from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('../AccessLevelDropdown', () => ({
  AccessLevelDropdown: ({
    person,
    canModify,
    currentUserCanGrantFullAccess,
    disabledReason,
  }: {
    person: IPeopleWithAccessType;
    canModify: boolean;
    currentUserCanGrantFullAccess: boolean;
    disabledReason?: string;
  }) => (
    <div
      data-testid={`access-level-${person.email}`}
      data-can-grant-full-access={String(currentUserCanGrantFullAccess)}
      data-can-modify={String(canModify)}
      data-disabled-reason={disabledReason}
    >
      {person.access_level}
    </div>
  ),
}));

const createPerson = (overrides: Partial<IPeopleWithAccessType> = {}): IPeopleWithAccessType => ({
  access_level: AccessLevel.FullAccess,
  avatar_url: '',
  email: 'owner@appflowy.local',
  name: 'Owner',
  pending_invitation: false,
  role: Role.Owner,
  ...overrides,
});

function renderPersonItem(overrides: Partial<ComponentProps<typeof PersonItem>> = {}) {
  const props: ComponentProps<typeof PersonItem> = {
    currentUserCanGrantFullAccess: true,
    currentUserHasFullAccess: true,
    currentUserIsOwner: false,
    isInheritedWorkspaceAccess: false,
    isYou: false,
    onAccessLevelChange: async () => undefined,
    onRemoveAccess: async () => undefined,
    person: createPerson(),
    ...overrides,
  };

  return render(<PersonItem {...props} />);
}

describe('PersonItem', () => {
  it('keeps workspace owner rows non-modifiable for page full-access members', () => {
    renderPersonItem();

    const ownerAccess = screen.getByTestId('access-level-owner@appflowy.local');

    expect(ownerAccess.dataset.canGrantFullAccess).toBe('true');
    expect(ownerAccess.dataset.canModify).toBe('false');
  });

  it('lets page full-access members modify non-owner member rows', () => {
    renderPersonItem({
      person: createPerson({
        access_level: AccessLevel.ReadAndWrite,
        email: 'member@appflowy.local',
        name: 'Member',
        role: Role.Member,
      }),
    });

    const memberAccess = screen.getByTestId('access-level-member@appflowy.local');

    expect(memberAccess.dataset.canGrantFullAccess).toBe('true');
    expect(memberAccess.dataset.canModify).toBe('true');
  });

  it('keeps database row-page person permissions disabled with a reason', () => {
    const disabledReason = 'Unable to change database row page permission.';

    renderPersonItem({
      permissionChangeDisabledReason: disabledReason,
      person: createPerson({
        access_level: AccessLevel.ReadAndWrite,
        email: 'member@appflowy.local',
        name: 'Member',
        role: Role.Member,
      }),
    });

    const memberAccess = screen.getByTestId('access-level-member@appflowy.local');

    expect(memberAccess.dataset.canModify).toBe('false');
    expect(memberAccess.dataset.disabledReason).toBe(disabledReason);
  });

  it('keeps Full Access recipients immutable for delegated share managers', () => {
    renderPersonItem({
      currentUserCanGrantFullAccess: false,
      person: createPerson({
        email: 'full-access-member@appflowy.local',
        name: 'Full access member',
        role: Role.Member,
      }),
    });

    const memberAccess = screen.getByTestId('access-level-full-access-member@appflowy.local');

    expect(memberAccess.dataset.canGrantFullAccess).toBe('false');
    expect(memberAccess.dataset.canModify).toBe('false');
  });

  it('keeps lower-tier recipients editable for delegated share managers', () => {
    renderPersonItem({
      currentUserCanGrantFullAccess: false,
      person: createPerson({
        access_level: AccessLevel.ReadAndWrite,
        email: 'editor@appflowy.local',
        name: 'Editor',
        role: Role.Member,
      }),
    });

    const memberAccess = screen.getByTestId('access-level-editor@appflowy.local');

    expect(memberAccess.dataset.canGrantFullAccess).toBe('false');
    expect(memberAccess.dataset.canModify).toBe('true');
  });

  it('does not let read-write users modify their own page permissions', () => {
    renderPersonItem({
      currentUserCanGrantFullAccess: false,
      currentUserHasFullAccess: false,
      isYou: true,
      person: createPerson({
        access_level: AccessLevel.ReadAndWrite,
        email: 'member@appflowy.local',
        name: 'Member',
        role: Role.Member,
      }),
    });

    const memberAccess = screen.getByTestId('access-level-member@appflowy.local');

    expect(memberAccess.dataset.canGrantFullAccess).toBe('false');
    expect(memberAccess.dataset.canModify).toBe('false');
  });

  it('does not let read-only users modify page permissions', () => {
    renderPersonItem({
      currentUserCanGrantFullAccess: false,
      currentUserHasFullAccess: false,
      person: createPerson({
        access_level: AccessLevel.ReadOnly,
        email: 'member@appflowy.local',
        name: 'Member',
        role: Role.Member,
      }),
    });

    const memberAccess = screen.getByTestId('access-level-member@appflowy.local');

    expect(memberAccess.dataset.canGrantFullAccess).toBe('false');
    expect(memberAccess.dataset.canModify).toBe('false');
  });
});
