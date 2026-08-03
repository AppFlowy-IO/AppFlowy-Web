import { render, screen } from '@testing-library/react';

import { useVirtualizer } from '@tanstack/react-virtual';

import CardList, { CardType, RenderCard } from '../CardList';

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

describe('CardList', () => {
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
