import { useVirtualizer } from '@tanstack/react-virtual';
import { render, screen } from '@testing-library/react';

import CardList, { CardType, ColumnOnScreenContext, RenderCard } from '../CardList';

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: jest.fn(),
}));

jest.mock('@/application/database-yjs', () => ({
  PADDING_END: 0,
}));

jest.mock('@/components/database/board/BoardProvider', () => ({
  useBoardActions: () => ({ setCreatingColumnId: jest.fn() }),
  useBoardSelection: () => ({ creatingColumnId: null }),
}));

jest.mock('@/components/database/components/board/card', () => ({
  Card: ({ rowId }: { rowId: string }) => <div data-testid='virtual-card'>{rowId}</div>,
}));

const mockUseVirtualizer = useVirtualizer as jest.MockedFunction<typeof useVirtualizer>;

function mockVirtualItems(indices: number[]) {
  mockUseVirtualizer.mockReturnValue({
    getTotalSize: () => 144,
    getVirtualItems: () => indices.map((index) => ({
      end: (index + 1) * 72, index, key: `row-${index}`, lane: 0, size: 72, start: index * 72,
    })),
    measureElement: jest.fn(),
    options: { scrollMargin: 0 },
  } as unknown as ReturnType<typeof useVirtualizer>);
}

describe('CardList', () => {
  it('shows a visible loading card until the viewport is measured, then renders its rows', () => {
    const data: RenderCard[] = [{ id: 'first-row', type: CardType.CARD }];

    // The real virtualizer has no range until its scroller gets a nonzero size.
    mockVirtualItems([]);
    const { container, rerender } = render(<CardList columnId='todo' data={data} fieldId='status-field' />);

    expect(screen.getByTestId('board-card-loading')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByTestId('virtual-card')).toBeNull();

    mockVirtualItems([0]);
    rerender(<CardList columnId='todo' data={[...data]} fieldId='status-field' />);

    expect(screen.queryByTestId('board-card-loading')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByTestId('virtual-card').textContent).toBe('first-row');
  });

  it.each<{ label: string; data: RenderCard[] }>([
    { label: 'empty', data: [] },
    { label: 'only the new-card action', data: [{ id: 'new', type: CardType.NEW_CARD }] },
  ])(
    'does not mark a column without persisted cards as loading: $label',
    ({ data }) => {
      mockVirtualItems([]);
      const { container } = render(<CardList columnId='todo' data={data} fieldId='status-field' />);

      expect(screen.queryByTestId('board-card-loading')).toBeNull();
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    }
  );

  it('keeps an intentionally unmounted offscreen column free of loading placeholders', () => {
    mockVirtualItems([]);
    const { container } = render(
      <ColumnOnScreenContext.Provider value={false}>
        <CardList columnId='todo' data={[{ id: 'first-row', type: CardType.CARD }]} fieldId='status-field' />
      </ColumnOnScreenContext.Provider>
    );

    expect(screen.queryByTestId('board-card-loading')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByTestId('virtual-card')).toBeNull();
  });

  it('renders every item selected by the measured virtualizer', () => {
    const data: RenderCard[] = Array.from({ length: 80 }, (_, index) => ({
      id: `row-${index}`,
      type: CardType.CARD,
    }));

    mockUseVirtualizer.mockReturnValue({
      getTotalSize: () => 5760,
      getVirtualItems: () =>
        data.map((_, index) => ({
          end: (index + 1) * 72,
          index,
          key: `row-${index}`,
          lane: 0,
          size: 72,
          start: index * 72,
        })),
      measureElement: jest.fn(),
      options: { scrollMargin: 0 },
    } as unknown as ReturnType<typeof useVirtualizer>);

    render(<CardList columnId='todo' data={data} fieldId='status-field' />);

    expect(screen.getAllByTestId('virtual-card')).toHaveLength(data.length);
  });
});
