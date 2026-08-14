import { act, fireEvent, render, screen } from '@testing-library/react';

import { useDatabaseContext, useDatabaseViewLayout, useReadOnly } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';

import { DatabaseActions } from '../DatabaseActions';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
  useDatabaseViewLayout: jest.fn(),
  useReadOnly: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'button.clear': 'Clear',
        'gallery.searchPlaceholder': 'Type to search',
        'search.label': 'Search',
        'settings.title': 'Settings',
        'tooltip.openAsPage': 'Open as page',
      }[key] ?? key),
  }),
}));

jest.mock('@/components/database/components/conditions/context', () => ({
  useConditionsContext: () => ({}),
}));

jest.mock('@/components/database/components/conditions/FiltersButton', () => ({
  __esModule: true,
  default: ({ compact }: { compact?: boolean }) => (
    <div data-compact={String(Boolean(compact))} data-testid='filters-button' />
  ),
}));

jest.mock('@/components/database/components/conditions/SortsButton', () => ({
  __esModule: true,
  default: ({ compact }: { compact?: boolean }) => (
    <div data-compact={String(Boolean(compact))} data-testid='sorts-button' />
  ),
}));

jest.mock('@/components/database/components/settings/Settings', () => ({
  __esModule: true,
  default: ({ children, layout }: { children: React.ReactNode; layout: DatabaseViewLayout }) => (
    <div data-database-settings-layout={layout}>{children}</div>
  ),
}));

jest.mock('@/components/database/components/template', () => ({
  DatabaseTemplateButton: ({ compact }: { compact?: boolean }) => (
    <button data-compact={String(Boolean(compact))} data-testid='database-template-button'>
      New
    </button>
  ),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;
const mockUseDatabaseViewLayout = useDatabaseViewLayout as jest.MockedFunction<typeof useDatabaseViewLayout>;
const mockUseReadOnly = useReadOnly as jest.MockedFunction<typeof useReadOnly>;

function SearchQueryProbe() {
  const { query } = useDatabaseSearch();

  return <output data-testid='database-search-query'>{query}</output>;
}

describe('DatabaseActions template support', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'view-1',
      isDocumentBlock: false,
    } as ReturnType<typeof useDatabaseContext>);
    mockUseReadOnly.mockReturnValue(false);
  });

  it.each([
    ['grid', DatabaseViewLayout.Grid],
    ['board', DatabaseViewLayout.Board],
    ['calendar', DatabaseViewLayout.Calendar],
    ['chart', DatabaseViewLayout.Chart],
    ['list', DatabaseViewLayout.List],
    ['gallery', DatabaseViewLayout.Gallery],
  ])('renders the template New button in the %s layout', (_name, layout) => {
    mockUseDatabaseViewLayout.mockReturnValue(layout);

    render(<DatabaseActions />);

    expect(screen.getByTestId('database-template-button')).toBeTruthy();
  });

  it('shows sorting in grid, list, and gallery layouts', () => {
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Board);

    const { rerender } = render(<DatabaseActions />);

    expect(screen.queryByTestId('sorts-button')).toBeNull();

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
    rerender(<DatabaseActions />);

    expect(screen.getByTestId('sorts-button')).toBeTruthy();

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.List);
    rerender(<DatabaseActions />);

    expect(screen.getByTestId('sorts-button')).toBeTruthy();

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);
    rerender(<DatabaseActions />);

    expect(screen.getByTestId('sorts-button')).toBeTruthy();
  });

  it('matches the editable Gallery action order and accessible labels', () => {
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'view-1',
      databasePageId: 'database-page',
      isDocumentBlock: true,
      navigateToView: jest.fn(),
    } as ReturnType<typeof useDatabaseContext>);

    render(
      <DatabaseSearchProvider activeViewId='view-1'>
        <DatabaseActions />
      </DatabaseSearchProvider>
    );

    const actionTestIds = Array.from(screen.getByTestId('database-actions').querySelectorAll('[data-testid]')).map(
      (element) => element.getAttribute('data-testid')
    );

    expect(actionTestIds).toEqual([
      'filters-button',
      'sorts-button',
      'database-actions-open-as-page',
      'database-actions-search',
      'database-actions-settings',
      'database-template-button',
    ]);
    expect(screen.getByTestId('database-actions-open-as-page').getAttribute('aria-label')).toBe('Open as page');
    expect(screen.getByTestId('database-actions-settings').getAttribute('aria-label')).toBe('Settings');
    expect(
      screen
        .getByTestId('database-actions-settings')
        .closest('[data-database-settings-layout]')
        ?.getAttribute('data-database-settings-layout')
    ).toBe(String(DatabaseViewLayout.Gallery));
    expect(screen.getByTestId('database-actions-search').getAttribute('aria-label')).toBe('Search');
    expect(screen.getByTestId('database-actions').querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.getByTestId('database-actions').className).toContain('gap-0.5');
    expect(screen.getByTestId('filters-button').getAttribute('data-compact')).toBe('true');
    expect(screen.getByTestId('sorts-button').getAttribute('data-compact')).toBe('true');

    for (const testId of ['database-actions-open-as-page', 'database-actions-search', 'database-actions-settings']) {
      expect(screen.getByTestId(testId).className).toContain('h-6');
      expect(screen.getByTestId(testId).className).toContain('w-6');
    }

    expect(screen.getByTestId('database-template-button').parentElement?.className).toContain('ml-1');
    expect(screen.getByTestId('database-template-button').getAttribute('data-compact')).toBe('true');
  });

  it('keeps only open-as-page and Search actions in a read-only Gallery', () => {
    mockUseReadOnly.mockReturnValue(true);
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'view-1',
      databasePageId: 'database-page',
      isDocumentBlock: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(
      <DatabaseSearchProvider activeViewId='view-1'>
        <DatabaseActions />
      </DatabaseSearchProvider>
    );

    expect(screen.getByTestId('database-actions-open-as-page')).toBeTruthy();
    expect(screen.getByTestId('database-actions-search')).toBeTruthy();
    expect(screen.queryByTestId('filters-button')).toBeNull();
    expect(screen.queryByTestId('sorts-button')).toBeNull();
    expect(screen.queryByTestId('database-actions-settings')).toBeNull();
    expect(screen.queryByTestId('database-template-button')).toBeNull();
  });

  it('updates the shared trimmed query after the desktop debounce and clears it with Escape', () => {
    jest.useFakeTimers();
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);

    render(
      <DatabaseSearchProvider activeViewId='view-1'>
        <DatabaseActions />
        <SearchQueryProbe />
      </DatabaseSearchProvider>
    );

    fireEvent.click(screen.getByTestId('database-actions-search'));
    fireEvent.change(screen.getByTestId('database-actions-search-input'), { target: { value: '  Roadmap  ' } });

    expect(screen.getByTestId('database-search-query').textContent).toBe('');
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByTestId('database-search-query').textContent).toBe('Roadmap');

    fireEvent.keyDown(screen.getByTestId('database-actions-search-input'), { key: 'Escape' });
    expect(screen.getByTestId('database-search-query').textContent).toBe('');
    expect(screen.queryByTestId('database-actions-search-input')).toBeNull();
    expect(screen.getByTestId('database-actions-search')).toBeTruthy();
  });
});
