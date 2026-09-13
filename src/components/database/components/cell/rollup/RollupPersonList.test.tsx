import { act, render, screen } from '@testing-library/react';

import { FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { MentionablePerson } from '@/application/types';

import { RollupCell } from './RollupCell';
import { RollupPersonList, parseRollupPersonIds } from './RollupPersonList';

let mockUsers: MentionablePerson[] = [];
const mockFetchUsers = jest.fn();
const anonymousId = '00000000-0000-0000-0000-000000000000';

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: (enabled: boolean) => {
    mockFetchUsers(enabled);
    return { users: mockUsers };
  },
}));
jest.mock('@/application/database-yjs/context', () => ({ useDatabaseContextOptional: () => null }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'signIn.anonymous' ? 'Anonymous' : 'Unknown user') }),
}));

beforeEach(() => {
  mockUsers = [];
  mockFetchUsers.mockClear();
});

test.each([
  ['', []],
  ['["alice", "bob"], ["alice"]', ['alice', 'bob', 'alice']],
  ['9007199254740993, 9007199254740992', ['9007199254740993', '9007199254740992']],
  ['["Last, First"], ["another"]', ['Last, First', 'another']],
  ['[["a"], [], ["b"]]', ['a', 'b']],
  ['unrecognized payload', ['unrecognized payload']],
])('parses desktop person payload %s without losing occurrences or ID precision', (value, expected) => {
  expect(parseRollupPersonIds(value)).toEqual(expected);
});

test.each([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy])(
  'source %s renders names and avatars when the roster arrives and changes',
  async (type) => {
    const value = type === FieldType.Person ? '["alice"], ["alice"]' : '9007199254740993, 9007199254740993';
    const mounted = render(<RollupPersonList value={value} type={type} />);

    const unresolvedId = type === FieldType.Person ? 'alice' : '9007199254740993';

    expect(screen.getAllByText(unresolvedId)).toHaveLength(2);
    mockUsers = [
      { person_id: 'alice', uid: '9007199254740993', name: 'Alice', avatar_url: '/alice.png' },
    ] as MentionablePerson[];
    await act(async () => {
      mounted.rerender(<RollupPersonList value={value} type={type} />);
    });
    expect(screen.getAllByText('Alice')).toHaveLength(2);
    expect(screen.queryByText(unresolvedId)).toBeNull();
    mockUsers = [{ ...mockUsers[0], name: 'Updated Alice', avatar_url: '/updated.png' }];
    await act(async () => {
      mounted.rerender(<RollupPersonList value={value} type={type} />);
    });
    expect(screen.getAllByText('Updated Alice')).toHaveLength(2);
  }
);

test('people rollup cells flatten multi-person source cells and retain bounded tags', () => {
  mockUsers = [
    { person_id: 'alice', name: 'Alice' },
    { person_id: 'bob', name: 'Bob' },
  ] as MentionablePerson[];
  render(
    <RollupCell
      rowId='row'
      fieldId='rollup'
      wrap={false}
      cell={{
        fieldType: FieldType.Rollup,
        data: '["alice","bob"], ["alice"]',
        createdAt: 0,
        lastModified: 0,
        targetFieldType: FieldType.Person,
        showAs: RollupDisplayMode.OriginalList,
      }}
    />
  );
  expect(screen.getAllByTestId('rollup-person-item')).toHaveLength(3);
  expect(screen.getAllByTestId('rollup-person-item').every((item) => item.className.includes('whitespace-nowrap'))).toBe(
    true
  );
});

test('anonymous-only Person rollups show Anonymous without a member-directory request', () => {
  render(<RollupPersonList value={`["${anonymousId}"]`} type={FieldType.Person} />);

  expect(screen.getByText('Anonymous')).toBeTruthy();
  expect(screen.queryByText(anonymousId)).toBeNull();
  expect(mockFetchUsers).toHaveBeenLastCalledWith(false);
});

test('mixed people, anonymous respondents, and duplicate occurrences preserve source order', () => {
  mockUsers = [{ person_id: 'alice', name: 'Alice' }] as MentionablePerson[];
  render(
    <RollupPersonList value={`["alice", "${anonymousId}"], ["alice"], ["${anonymousId}"]`} type={FieldType.Person} />
  );

  const labels = screen
    .getAllByTestId('rollup-person-item')
    .map((item) => item.querySelector('span.truncate')?.textContent);

  expect(labels).toEqual(['Alice', 'Anonymous', 'Alice', 'Anonymous']);
  expect(mockFetchUsers).toHaveBeenLastCalledWith(true);
});

test.each([FieldType.CreatedBy, FieldType.LastEditedBy])(
  'attribution source %s does not interpret Person sentinels',
  (type) => {
    render(<RollupPersonList value={`["${anonymousId}"]`} type={type} />);

    expect(screen.getByText(anonymousId)).toBeTruthy();
    expect(screen.queryByText('Anonymous')).toBeNull();
  }
);

test.each([
  ['["unknown, member"], ["unknown, member"]', 'unknown, member', 2],
  ['unrecognized payload', 'unrecognized payload', 1],
])('unresolved or malformed payload %s remains distinguishable', (value, label, occurrences) => {
  render(<RollupPersonList value={value} type={FieldType.Person} />);

  expect(screen.getAllByText(label)).toHaveLength(occurrences);
  expect(screen.queryByText('Unknown user')).toBeNull();
});
