import { render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import { useFieldType, useRowDataSelector } from '@/application/database-yjs/selector';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

import { AttributionCell } from '../AttributionCell';

jest.mock('@/application/database-yjs/selector', () => ({
  useFieldType: jest.fn(),
  useRowDataSelector: jest.fn(),
}));

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: jest.fn(),
}));

jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span data-testid='attribution-avatar-color-key'>{children}</span>
  ),
  AvatarImage: () => null,
}));

const mockUseFieldType = useFieldType as jest.MockedFunction<typeof useFieldType>;
const mockUseRowDataSelector = useRowDataSelector as jest.MockedFunction<typeof useRowDataSelector>;
const mockUseMentionableUsersWithAutoFetch = useMentionableUsersWithAutoFetch as jest.MockedFunction<
  typeof useMentionableUsersWithAutoFetch
>;

describe('AttributionCell avatar', () => {
  it.each([
    ['the member name', 'Nathan Foo', 'nathan@appflowy.io', 'Nathan Foo'],
    ['the member email when the name is empty', '', 'eva@appflowy.io', 'eva@appflowy.io'],
  ])('uses %s as the fallback color key', (_source, name, email, expectedColorKey) => {
    const row = { get: jest.fn(() => '42') };
    const user = {
      avatar_url: '',
      email,
      name,
      person_id: 'person-42',
      uid: '42',
    };

    mockUseFieldType.mockReturnValue(FieldType.CreatedBy);
    mockUseRowDataSelector.mockReturnValue({ row } as unknown as ReturnType<typeof useRowDataSelector>);
    mockUseMentionableUsersWithAutoFetch.mockReturnValue({
      loading: false,
      users: [user],
      usersByUid: new Map([['42', user]]),
    });

    render(<AttributionCell fieldId='created-by' readOnly rowId='row-1' wrap={false} />);

    expect(screen.getByTestId('attribution-avatar-color-key').textContent).toBe(expectedColorKey);
  });
});
