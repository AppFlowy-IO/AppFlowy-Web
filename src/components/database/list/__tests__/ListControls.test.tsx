import { fireEvent, render, screen } from '@testing-library/react';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';

import { ListLoadMore, ListLoadMoreIndicator, ListLoadingIndicator, ListNewRow } from '../ListControls';

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseNewRowDispatch = useNewRowDispatch as jest.MockedFunction<typeof useNewRowDispatch>;

describe('List controls Flutter desktop geometry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNewRowDispatch.mockReturnValue(jest.fn());
  });

  it('uses Desktop loading indicator sizes and padding', () => {
    const { rerender } = render(<ListLoadingIndicator />);

    const initial = screen.getByRole('status', { name: 'Loading rows' });

    expect(initial.className).toContain('pt-[30px]');
    expect(initial.firstElementChild?.className).toContain('h-9');

    rerender(<ListLoadMoreIndicator />);
    const incremental = screen.getByRole('status', { name: 'Loading more rows' });

    expect(incremental.className).toContain('h-14');
    expect(incremental.firstElementChild?.className).toContain('h-6');
  });

  it('fills tight standalone height while keeping embedded loading shrink-wrapped', () => {
    const { rerender } = render(<ListLoadingIndicator fillAvailable />);

    expect(screen.getByRole('status', { name: 'Loading rows' }).className).toContain('h-full');
    rerender(<ListLoadingIndicator />);
    expect(screen.getByRole('status', { name: 'Loading rows' }).className).not.toContain('h-full');
  });

  it('renders the 32px explicit load-more control with 8px icon gap', () => {
    const onLoadMore = jest.fn();

    render(<ListLoadMore onLoadMore={onLoadMore} remainingCount={50} />);

    const button = screen.getByTestId('list-load-more');

    expect(button.className).toContain('h-8');
    expect(button.className).toContain('gap-2');
    expect(button.textContent).toContain('(50)');
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders the 40px new-row footer and requests an opened trailing row', () => {
    const createRow = jest.fn();

    mockUseNewRowDispatch.mockReturnValue(createRow);
    render(<ListNewRow />);

    const button = screen.getByTestId('list-new-row');

    expect(button.className).toContain('h-10');
    fireEvent.click(button);
    expect(createRow).toHaveBeenCalledWith({ openAfterCreate: true, tailing: true });
  });
});
