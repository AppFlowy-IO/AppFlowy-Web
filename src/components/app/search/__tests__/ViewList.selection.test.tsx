import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { ViewLayout } from '@/application/types';

import ViewList, { SearchViewListItem } from '../ViewList';

const mockNavigateToView = jest.fn();
const mockOnClose = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useToView: () => mockNavigateToView,
}));

jest.mock('@/components/app/search/ListItem', () => ({
  __esModule: true,
  default: ({ itemId, selected }: { itemId: string; selected: boolean }) => (
    <div data-item-id={itemId} data-testid={itemId} aria-selected={selected} />
  ),
}));

function item(id: string, rowId?: string): SearchViewListItem {
  return {
    id,
    rowId,
    view: {
      view_id: `view-${id}`,
      name: id,
      icon: null,
      layout: ViewLayout.Document,
      extra: null,
      children: [],
      is_published: false,
      is_private: false,
    },
  };
}

function list(items: SearchViewListItem[], query = 'search', selectionKey = query) {
  return (
    <ViewList
      title='Results'
      items={items}
      query={query}
      selectionKey={selectionKey}
      loading={false}
      onClose={mockOnClose}
    />
  );
}

function press(key: 'ArrowDown' | 'Enter') {
  const keyCode = key === 'Enter' ? 13 : 40;

  fireEvent.keyDown(document, { key, keyCode, which: keyCode });
}

describe('ViewList keyboard selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('keeps the selected target when a final snapshot replaces and reorders results', () => {
    const { rerender } = render(list([item('a', 'row-a'), item('b')]));

    press('ArrowDown');
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('true');
    rerender(list([item('b'), item('a', 'row-a')]));
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('true');
    press('Enter');
    expect(mockNavigateToView).toHaveBeenCalledWith('view-a', 'row-a');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('clears selection when the query changes even if the same target remains', () => {
    const { rerender } = render(list([item('a')]));

    press('ArrowDown');
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('true');
    rerender(list([item('a')], 'another query'));
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('false');
    press('Enter');
    expect(mockNavigateToView).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('clears selection when the workspace session changes with the same query', () => {
    const { rerender } = render(list([item('a')], 'search', 'workspace-a:search'));

    press('ArrowDown');
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('true');
    rerender(list([item('a')], 'search', 'workspace-b:search'));
    press('Enter');
    expect(mockNavigateToView).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('does not substitute another target or restore selection after the selected result disappears', () => {
    const { rerender } = render(list([item('a'), item('b')]));

    press('ArrowDown');
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('true');
    rerender(list([item('b')]));
    press('Enter');
    expect(mockNavigateToView).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
    rerender(list([item('a'), item('b')]));
    press('Enter');
    expect(mockNavigateToView).not.toHaveBeenCalled();
    press('ArrowDown');
    press('Enter');
    expect(mockNavigateToView).toHaveBeenCalledWith('view-a', undefined);
  });

  it('uses the committed query before passive effects run', () => {
    function Search({ query, enterOnCommit = false }: { query: string; enterOnCommit?: boolean }) {
      useLayoutEffect(() => {
        if (enterOnCommit) press('Enter');
      }, [enterOnCommit, query]);
      return list([item('a')], query);
    }

    const { rerender } = render(<Search query='search' />);

    press('ArrowDown');
    expect(screen.getByTestId('a').getAttribute('aria-selected')).toBe('true');
    rerender(<Search query='another query' enterOnCommit />);
    expect(mockNavigateToView).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
