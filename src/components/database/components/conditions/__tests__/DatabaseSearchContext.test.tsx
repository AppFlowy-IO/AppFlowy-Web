import { fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseSearchQuery } from '@/application/database-yjs/context';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';

function SearchConsumer() {
  const { query, setQuery, clearSearch, clearToken, focusSearchToken } = useDatabaseSearch();
  const rowQuery = useDatabaseSearchQuery();

  return (
    <>
      <output data-testid='query'>{query}</output>
      <output data-testid='row-query'>{rowQuery}</output>
      <output data-testid='clear-token'>{clearToken}</output>
      <output data-testid='focus-token'>{focusSearchToken}</output>
      <button onClick={() => setQuery('roadmap')} type='button'>
        Set query
      </button>
      <button onClick={() => clearSearch()} type='button'>
        Clear
      </button>
      <button onClick={() => clearSearch({ focusSearch: true })} type='button'>
        Clear and focus
      </button>
    </>
  );
}

describe('DatabaseSearchProvider', () => {
  it('resets the query when the active view changes without restoring an older view query', () => {
    const { rerender } = render(
      <DatabaseSearchProvider activeViewId='gallery-a'>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    expect(screen.getByTestId('query').textContent).toBe('roadmap');

    rerender(
      <DatabaseSearchProvider activeViewId='gallery-b'>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );
    expect(screen.getByTestId('query').textContent).toBe('');

    rerender(
      <DatabaseSearchProvider activeViewId='gallery-a'>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );
    expect(screen.getByTestId('query').textContent).toBe('');
  });

  it('hands the query to the row selectors only when it applies to rows (Grid, List, Board)', () => {
    const { rerender } = render(
      <DatabaseSearchProvider activeViewId='grid' applyToRows>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    expect(screen.getByTestId('row-query').textContent).toBe('roadmap');

    // Gallery and Feed keep their card-level search: the rows see no query.
    rerender(
      <DatabaseSearchProvider activeViewId='grid' applyToRows={false}>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );
    expect(screen.getByTestId('query').textContent).toBe('roadmap');
    expect(screen.getByTestId('row-query').textContent).toBe('');
  });

  it('clears the query and changes the clear token, and the focus token only when asked', () => {
    render(
      <DatabaseSearchProvider activeViewId='grid' applyToRows>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('query').textContent).toBe('');
    expect(screen.getByTestId('clear-token').textContent).toBe('1');
    expect(screen.getByTestId('focus-token').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Clear and focus' }));
    expect(screen.getByTestId('clear-token').textContent).toBe('2');
    expect(screen.getByTestId('focus-token').textContent).toBe('1');
  });

  it('clears the query when its reset key changes (entering Edit mode)', () => {
    const { rerender } = render(
      <DatabaseSearchProvider activeViewId='grid' applyToRows resetKey={false}>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    rerender(
      <DatabaseSearchProvider activeViewId='grid' applyToRows resetKey={false}>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );
    expect(screen.getByTestId('query').textContent).toBe('roadmap');
    rerender(
      <DatabaseSearchProvider activeViewId='grid' applyToRows resetKey>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );
    expect(screen.getByTestId('query').textContent).toBe('');
    expect(screen.getByTestId('row-query').textContent).toBe('');
    expect(screen.getByTestId('clear-token').textContent).toBe('1');
  });

  it('reports when the search starts and ends, and ends it when the provider goes away', () => {
    const onActiveChange = jest.fn();
    const { unmount } = render(
      <DatabaseSearchProvider activeViewId='grid' applyToRows onActiveChange={onActiveChange}>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );

    expect(onActiveChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    unmount();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(onActiveChange).toHaveBeenCalledTimes(4);
  });

  it('reports no row search for a card-level search (Gallery, Feed)', () => {
    const onActiveChange = jest.fn();

    render(
      <DatabaseSearchProvider activeViewId='gallery' onActiveChange={onActiveChange}>
        <SearchConsumer />
      </DatabaseSearchProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    expect(screen.getByTestId('query').textContent).toBe('roadmap');
    expect(onActiveChange).not.toHaveBeenCalled();
  });
});
