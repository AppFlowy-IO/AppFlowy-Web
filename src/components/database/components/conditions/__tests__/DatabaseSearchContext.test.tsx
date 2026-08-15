import { fireEvent, render, screen } from '@testing-library/react';

import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';

function SearchConsumer() {
  const { query, setQuery } = useDatabaseSearch();

  return (
    <>
      <output data-testid='query'>{query}</output>
      <button onClick={() => setQuery('roadmap')} type='button'>
        Set query
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
});
