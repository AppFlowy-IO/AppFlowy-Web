import { render, waitFor } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import type { PersonCell as PersonCellData } from '@/application/database-yjs/cell.type';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

import { PersonCell } from '../PersonCell';

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: jest.fn(),
}));

jest.mock('@/components/database/components/cell/person/PersonCellMenu', () => () => null);

jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarFallback: () => null,
  AvatarImage: () => null,
}));

const mockUseMentionableUsersWithAutoFetch = useMentionableUsersWithAutoFetch as jest.MockedFunction<
  typeof useMentionableUsersWithAutoFetch
>;

describe('PersonCell display text', () => {
  it('reports the same resolved name that it renders', async () => {
    const onTextChange = jest.fn();
    const cell: PersonCellData = {
      createdAt: 0,
      data: JSON.stringify(['person-1']),
      fieldType: FieldType.Person,
      lastModified: 0,
    };

    mockUseMentionableUsersWithAutoFetch.mockReturnValue({
      loading: false,
      users: [
        {
          avatar_url: '',
          email: 'alice@example.com',
          name: 'Alice',
          person_id: 'person-1',
        },
      ],
    });

    const { getByText } = render(
      <PersonCell cell={cell} fieldId='people' onTextChange={onTextChange} readOnly rowId='row-1' wrap={false} />
    );

    expect(getByText('Alice')).toBeTruthy();
    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Alice'));
  });
});
