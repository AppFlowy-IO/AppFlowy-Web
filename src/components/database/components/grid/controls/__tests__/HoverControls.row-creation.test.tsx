import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GridDragState } from '@/components/database/components/grid/drag-and-drop/GridDragContext';

import { HoverControls } from '../HoverControls';

const mockCreate = jest.fn();
let mockSorted = false;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseFields: () => ({}),
  useDatabaseView: () => undefined,
  useSortsSelector: () => (mockSorted ? [{}] : []),
}));

jest.mock('@/application/database-yjs/dispatch', () => {
  const { useEffect, useRef } = jest.requireActual('react');

  return {
    useDuplicateRowDispatch: () => jest.fn(),
    useNewRowDispatch: () => {
      const mounted = useRef(true);

      useEffect(() => () => { mounted.current = false; }, []);
      // Atomic row creation must retain its owning component until commit.
      return (options: unknown) => mockCreate(options, () => mounted.current);
    },
  };
});

jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => ({ rowOrders: [{ id: 'row-a' }] }),
  useIsGridRowHovered: () => true,
}));

jest.mock('@/components/database/components/grid/grid-row/GridNewRow', () => ({
  getGridGroupCellsData: (_fields: unknown, fieldId: string, groupId: string) => ({ [fieldId]: groupId }),
}));

jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/sorts/ClearSortingConfirm', () => ({
  __esModule: true,
  default: ({ onRemoved, onClose }: { onRemoved: () => void; onClose: () => void }) => (
    <button onClick={() => { onRemoved(); onClose(); }}>Remove sorting</button>
  ),
}));

describe('row creation from the grid row menu', () => {
  beforeEach(() => { mockCreate.mockReset(); });

  it.each([false, true])('keeps the row owner alive after the menu closes (sorted: %s)', async (sorted) => {
    mockSorted = sorted;
    let finish!: () => void;
    let isOwnerMounted!: () => boolean;

    mockCreate.mockImplementation((_options: unknown, isMounted: () => boolean) => {
      isOwnerMounted = isMounted;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    render(
      <HoverControls
        rowId='row-a'
        rowKey='row-a'
        groupFieldId='status'
        groupId='ready'
        state={{ type: GridDragState.IDLE }}
      />
    );

    fireEvent.click(screen.getByTestId('row-accessory-button'));
    fireEvent.click(await screen.findByTestId('row-menu-insert-below'));
    await waitFor(() => expect(screen.queryByTestId('row-menu-insert-below')).toBeNull());
    if (sorted) fireEvent.click(screen.getByText('Remove sorting'));

    expect(mockCreate).toHaveBeenCalledWith({ beforeRowId: 'row-a', cellsData: { status: 'ready' } }, expect.any(Function));
    expect(isOwnerMounted()).toBe(true);
    await act(async () => { finish(); });
  });
});
