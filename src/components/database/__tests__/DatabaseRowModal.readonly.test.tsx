import { render, screen } from '@testing-library/react';

import { useReadOnly } from '@/application/database-yjs';
import DatabaseRowModal from '@/components/database/DatabaseRowModal';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContextOptional: jest.fn(() => ({})),
  useReadOnly: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useDuplicateRowDispatch: jest.fn(() => jest.fn()),
  useTrashAwareDeleteRowsDispatch: jest.fn(() => jest.fn()),
}));

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: ({ rowId }: { rowId: string }) => <div data-testid={`database-row-${rowId}`} />,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;

describe('DatabaseRowModal readonly actions', () => {
  it('keeps readonly navigation available but removes duplicate and delete controls', () => {
    mockUseReadOnly.mockReturnValue(true);
    const openPage = jest.fn();

    render(<DatabaseRowModal onOpenChange={jest.fn()} open openPage={openPage} rowId='row-1' />);

    expect(screen.getByTestId('database-row-row-1')).toBeTruthy();
    expect(screen.queryByTestId('row-detail-more-actions')).toBeNull();
    expect(screen.queryByTestId('row-detail-duplicate')).toBeNull();
    expect(screen.queryByTestId('row-detail-delete')).toBeNull();
    expect(screen.getByTestId('row-detail-open-full-page')).toBeTruthy();
  });

  it('keeps the row mutation menu available for editable databases', () => {
    mockUseReadOnly.mockReturnValue(false);

    render(<DatabaseRowModal onOpenChange={jest.fn()} open openPage={jest.fn()} rowId='row-1' />);

    expect(screen.getByTestId('row-detail-open-full-page')).toBeTruthy();
    expect(screen.getByTestId('row-detail-more-actions')).toBeTruthy();
  });
});
