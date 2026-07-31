import EventEmitter from 'events';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccessLevel, IPeopleWithAccessType, Role } from '@/application/types';
import { PeopleWithAccess } from '@/components/app/share/PeopleWithAccess';
import { ShareSectionType } from '@/components/app/share/shareSectionType';

const mockRevokeAccess = jest.fn();
const mockNavigate = jest.fn();
const mockEventEmitter = new EventEmitter();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    revokeAccess: (...args: unknown[]) => mockRevokeAccess(...args),
    sharePageTo: jest.fn(),
    turnIntoMember: jest.fn(),
  },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-1',
  useEventEmitter: () => mockEventEmitter,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'owner@appflowy.io' }),
}));

jest.mock('@/components/app/share/PersonItem', () => ({
  PersonItem: ({
    person,
    onRemoveAccess,
  }: {
    person: IPeopleWithAccessType;
    onRemoveAccess: (email: string) => Promise<void>;
  }) => <button onClick={() => void onRemoveAccess(person.email)}>{person.email}</button>,
}));

const removedPerson: IPeopleWithAccessType = {
  email: 'removed@appflowy.io',
  name: 'Removed user',
  access_level: AccessLevel.ReadOnly,
  role: Role.Guest,
  avatar_url: '',
  pending_invitation: false,
};

describe('PeopleWithAccess', () => {
  beforeEach(() => {
    mockRevokeAccess.mockReset();
    mockRevokeAccess.mockResolvedValue(undefined);
    mockNavigate.mockReset();
  });

  it('optimistically removes a successfully revoked row before revalidation', async () => {
    const onPeopleChange = jest.fn(async () => undefined);
    const onPersonRemoved = jest.fn();

    render(
      <PeopleWithAccess
        viewId='view-1'
        people={[removedPerson]}
        isLoading={false}
        onPeopleChange={onPeopleChange}
        onPersonRemoved={onPersonRemoved}
        hasFullAccess
        canGrantFullAccess
        sectionType={ShareSectionType.Shared}
      />
    );

    fireEvent.click(screen.getByText(removedPerson.email));

    await waitFor(() => expect(onPeopleChange).toHaveBeenCalledTimes(1));
    expect(mockRevokeAccess).toHaveBeenCalledWith('workspace-1', 'view-1', [removedPerson.email]);
    expect(onPersonRemoved).toHaveBeenCalledTimes(1);
    expect(onPersonRemoved).toHaveBeenCalledWith(removedPerson.email);
  });
});
