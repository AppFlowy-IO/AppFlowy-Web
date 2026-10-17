import { render, waitFor } from '@testing-library/react';

import type { PersonCell as PersonCellData } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
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

describe('PersonCell search text', () => {
  it('indexes name and email while rendering the name, and drops removed members', async () => {
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

    const { getByText, queryByText, rerender } = render(
      <PersonCell cell={cell} fieldId='people' onTextChange={onTextChange} readOnly rowId='row-1' wrap={false} />
    );

    expect(getByText('Alice')).toBeTruthy();
    expect(queryByText('alice@example.com')).toBeNull();
    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Alice alice@example.com'));

    rerender(
      <PersonCell
        cell={{ ...cell, data: '[]' }}
        fieldId='people'
        onTextChange={onTextChange}
        readOnly
        rowId='row-1'
        wrap={false}
      />
    );

    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith(''));
    expect(queryByText('Alice')).toBeNull();
  });
});

describe('PersonCell name hook', () => {
  const ANONYMOUS_RESPONDENT_ID = '00000000-0000-0000-0000-000000000000';

  beforeEach(() => {
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
  });

  it('tags member and Anonymous names with person-cell-name while keeping them visible', () => {
    const cell: PersonCellData = {
      createdAt: 0,
      data: JSON.stringify(['person-1', ANONYMOUS_RESPONDENT_ID]),
      fieldType: FieldType.Person,
      lastModified: 0,
    };

    const { container } = render(<PersonCell cell={cell} fieldId='people' readOnly rowId='row-1' wrap={false} />);

    const names = Array.from(container.querySelectorAll('.person-cell-name'));

    expect(names.map((name) => name.textContent)).toEqual(['Alice', 'Anonymous']);
    // Compact renderers (ListCell) hide the names through this hook; PersonCell itself never does,
    // so Grid and Board keep showing avatar + name.
    names.forEach((name) => {
      expect(name.className).toContain('truncate');
      expect(name.className).toContain('text-sm');
      expect(name.className).not.toContain('sr-only');
    });
    expect(names[1].className).toContain('text-text-tertiary');
  });

  it('keeps the 4px gap between entries so avatar-only renderers match Flutter spacing: 4.0', () => {
    const cell: PersonCellData = {
      createdAt: 0,
      data: JSON.stringify(['person-1']),
      fieldType: FieldType.Person,
      lastModified: 0,
    };

    const { getByTestId } = render(<PersonCell cell={cell} fieldId='people' readOnly rowId='row-1' wrap={false} />);

    const root = getByTestId('person-cell-row-1-people');

    expect(root.className).toContain('select-option-cell');
    expect(root.className).toContain('gap-1');
    expect(root.querySelector('.person-cell-name')?.parentElement?.className).toContain('gap-1');
  });
});
