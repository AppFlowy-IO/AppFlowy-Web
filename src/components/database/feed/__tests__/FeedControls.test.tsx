import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { Log } from '@/utils/log';

import { FeedEmptyState, FeedLoadMore, FeedNewRow } from '../FeedControls';

jest.mock('@/application/database-yjs/dispatch', () => ({ useNewRowDispatch: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { error: jest.fn() } }));

const mockUseNewRowDispatch = useNewRowDispatch as jest.MockedFunction<typeof useNewRowDispatch>;

describe('Feed controls', () => {
  const createRow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    createRow.mockResolvedValue(undefined);
    mockUseNewRowDispatch.mockReturnValue(createRow);
  });

  it('creates a trailing row and opens its detail page like Desktop feedAddRowButtonKey', async () => {
    render(<FeedNewRow />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('feed-new-row'));
    });

    expect(createRow).toHaveBeenCalledWith({ openAfterCreate: true, tailing: true });
    expect(screen.getByTestId('feed-new-row').textContent).toContain('grid.row.newRow');
  });

  it('reports creation failures', async () => {
    createRow.mockRejectedValue(new Error('boom'));
    render(<FeedNewRow />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('feed-new-row'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(Log.error).toHaveBeenCalled();
    expect(screen.getByTestId<HTMLButtonElement>('feed-new-row').disabled).toBe(false);
  });

  it('renders the load-more remaining count and the empty state copy', () => {
    const onLoadMore = jest.fn();

    render(
      <>
        <FeedLoadMore onLoadMore={onLoadMore} remainingCount={7} />
        <FeedEmptyState />
      </>
    );

    expect(screen.getByTestId('feed-load-more').textContent).toContain('(7)');
    fireEvent.click(screen.getByTestId('feed-load-more'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('feed-empty').textContent).toBe('feed.noItemsInFeed');
  });
});
