import { act, fireEvent, render, screen } from '@testing-library/react';

import { DatabaseSearchAction } from '@/components/database/components/conditions/DatabaseSearchAction';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';
import { DatabaseSearchEmptyState } from '@/components/database/components/conditions/DatabaseSearchEmptyState';

let mockIsDashboardWidget = false;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => ({ isDashboardWidget: mockIsDashboardWidget }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'databaseSearch.noResults': 'No results',
        'databaseSearch.clearSearch': 'Clear search',
        'databaseSearch.placeholder': 'Type to search...',
        'search.label': 'Search',
      }[key] ?? key),
  }),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function QueryProbe() {
  return <output data-testid='query'>{useDatabaseSearch().query}</output>;
}

describe('DatabaseSearchEmptyState (WP09 §1.2)', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockIsDashboardWidget = false;
  });

  it('says "No results" as a live status with an outlined Clear search button', () => {
    render(<DatabaseSearchEmptyState />);

    const state = screen.getByTestId('database-search-empty-state');

    expect(state.getAttribute('role')).toBe('status');
    expect(state.textContent).toContain('No results');
    const label = state.querySelector('[data-parity-id="dash-widget-search-empty"]');

    // The parity id marks the "No results" label only, as on desktop.
    expect(label?.textContent).toBe('No results');
    const clear = screen.getByTestId('database-search-clear-search');

    expect(clear.textContent).toBe('Clear search');
    expect(clear.getAttribute('data-parity-id')).toBe('dash-widget-search-clear');
    expect(clear.className).toContain('h-7');
    expect(clear.className).toContain('border-border-primary');
    expect(clear.className).toContain('rounded-200');
  });

  it('is centred in a widget card and a 160px block 48px from the top elsewhere', () => {
    const { unmount } = render(<DatabaseSearchEmptyState />);

    expect(screen.getByTestId('database-search-empty-state').className).toContain('min-h-[160px]');
    expect(screen.getByTestId('database-search-empty-state').className).toContain('pt-12');
    unmount();
    mockIsDashboardWidget = true;
    render(<DatabaseSearchEmptyState />);
    expect(screen.getByTestId('database-search-empty-state').className).toContain('justify-center');
    expect(screen.getByTestId('database-search-empty-state').className).not.toContain('pt-12');
  });

  it('clears the query, collapses the search field and focuses the Search button', () => {
    jest.useFakeTimers();
    render(
      <DatabaseSearchProvider activeViewId='grid' applyToRows>
        <DatabaseSearchAction variant='widget' />
        <DatabaseSearchEmptyState />
        <QueryProbe />
      </DatabaseSearchProvider>
    );

    fireEvent.click(screen.getByTestId('database-actions-search'));
    fireEvent.change(screen.getByTestId('database-actions-search-input'), { target: { value: 'zzqx' } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('query').textContent).toBe('zzqx');

    fireEvent.click(screen.getByTestId('database-search-clear-search'));
    expect(screen.getByTestId('query').textContent).toBe('');
    expect(screen.queryByTestId('database-actions-search-field')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('database-actions-search'));
    // Nothing commits the old text once the debounce elapses.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('query').textContent).toBe('');
  });
});
