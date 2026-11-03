import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useCallback, useMemo, useState } from 'react';

import { DatabaseViewLayout } from '@/application/types';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';

import { createWidgetContextValue } from '../../__tests__/dashboardTestHarness';
import { WidgetContext } from '../../WidgetContext';
import { WidgetHeaderFrame } from '../../WidgetHeader';
import { MobileWidgetTools } from '../MobileWidgetTools';

let mockLayout: DatabaseViewLayout | null = DatabaseViewLayout.Grid;
let mockFilters: { id: string }[] = [];
let mockConditionsReadOnly = false;
const mockAddFilter = jest.fn(() => 'new-filter');

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ??
      { 'grid.settings.filter': 'Filter', 'search.label': 'Search', 'databaseSearch.placeholder': 'Type to search...' }[
        key
      ] ??
      key,
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
  useDatabaseViewLayout: () => mockLayout,
  useReadOnly: () => mockConditionsReadOnly,
  useConditionsReadOnly: () => mockConditionsReadOnly,
  useFiltersSelector: () => mockFilters,
  useSortsSelector: () => [],
  useAdvancedFiltersSelector: () => [],
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddFilter: () => mockAddFilter,
  useAddAdvancedFilterAndRebuild: () => jest.fn(),
  useAddSort: () => jest.fn(),
  useClearSortingDispatch: () => jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch/sort-filter', () => ({
  useMoveFilter: () => jest.fn(),
}));

// The property picker of "Add filter": its trigger, and a property to pick while it is open.
jest.mock('@/components/database/components/conditions/PropertiesMenu', () => ({
  __esModule: true,
  default: ({
    children,
    open,
    onSelect,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onSelect: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <>
      {children}
      {open ? (
        <button
          data-testid='pick-property'
          onClick={() => {
            onSelect('field-1');
            onOpenChange?.(false);
          }}
          type='button'
        />
      ) : null}
    </>
  ),
}));

jest.mock('@/components/database/components/filters/Filter', () => ({
  __esModule: true,
  default: ({ filterId }: { filterId: string }) => <div data-filter-id={filterId} data-testid='filter-chip' />,
}));

jest.mock('@/components/database/components/filters/advanced', () => ({
  AdvancedFiltersBadge: () => <div data-testid='advanced-filters-badge' />,
}));

jest.mock('@/components/database/components/sorts/SortList', () => ({
  __esModule: true,
  default: () => <div data-testid='sort-list' />,
}));

jest.mock('@/components/database/components/sorts/utils', () => ({
  useRollupSortableIds: () => new Set<string>(),
}));

// The header is rendered with these tools as its actions; the widget's default tools and the settings host stay out.
jest.mock('../../widget-tool-buttons/WidgetActions', () => ({
  WidgetActions: () => null,
}));

jest.mock('../../WidgetSettingsHost', () => ({
  WidgetSettingsHost: () => null,
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: () => <span data-testid='page-icon' />,
}));

function QueryProbe() {
  const { query } = useDatabaseSearch();

  return <output data-testid='search-query'>{query}</output>;
}

/**
 * A phone's widget header inside its nested database, as `DatabaseViews`
 * composes it: the conditions context (the widget's filter panel is its
 * `expanded`), the session search, and the widget's real search state.
 */
function PhoneWidget({ showWidgetTitles = true }: { showWidgetTitles?: boolean }) {
  const [expanded, setExpandedState] = useState(false);
  const [openFilterId, setOpenFilterId] = useState<string>();
  const [searchActive, setSearchActive] = useState(false);
  const setExpanded = useCallback((next: boolean) => setExpandedState(next), []);
  const conditions = useMemo(
    () => ({
      expanded,
      toggleExpanded: () => setExpandedState((current) => !current),
      setExpanded,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode: false,
      setAdvancedMode: jest.fn(),
      advancedPanelOpen: false,
      setAdvancedPanelOpen: jest.fn(),
    }),
    [expanded, openFilterId, setExpanded]
  );

  return (
    <WidgetContext.Provider
      value={createWidgetContextValue({
        name: 'Projects Grid',
        mobileContext: true,
        searchActive,
        setSearchActive,
        showWidgetTitles,
        headerHeight: showWidgetTitles ? 40 : 0,
      })}
    >
      <DatabaseConditionsContext.Provider value={conditions}>
        <DatabaseSearchProvider activeViewId='v1' applyToRows>
          <WidgetHeaderFrame actions={<MobileWidgetTools />} />
          <QueryProbe />
          <output data-testid='filter-panel-state'>{expanded ? 'open' : 'closed'}</output>
        </DatabaseSearchProvider>
      </DatabaseConditionsContext.Provider>
    </WidgetContext.Provider>
  );
}

const tools = () =>
  Array.from(document.querySelectorAll('[data-widget-tool]')).map((slot) => slot.getAttribute('data-widget-tool'));

beforeEach(() => {
  mockLayout = DatabaseViewLayout.Grid;
  mockFilters = [];
  mockConditionsReadOnly = false;
  jest.clearAllMocks();
});

describe('MobileWidgetTools', () => {
  it.each([
    ['Grid', 'Search, Filter', DatabaseViewLayout.Grid, ['search', 'filter']],
    ['List', 'Search, Filter', DatabaseViewLayout.List, ['search', 'filter']],
    ['Board', 'Search, Filter', DatabaseViewLayout.Board, ['search', 'filter']],
    ['Chart', 'Filter', DatabaseViewLayout.Chart, ['filter']],
    ['Calendar', 'Filter', DatabaseViewLayout.Calendar, ['filter']],
    ['Gallery', 'Filter', DatabaseViewLayout.Gallery, ['filter']],
  ])('gives a %s widget %s, always visible, with a 40px hit area', (_name, _label, layout, expected) => {
    mockLayout = layout;
    render(<PhoneWidget />);
    const container = screen.getByTestId('database-actions');

    expect(tools()).toEqual(expected);
    expect(container.getAttribute('data-mobile')).toBe('true');
    expect(container.getAttribute('data-force-visible')).toBe('true');
    expect(container.getAttribute('data-dashboard-widget')).toBe('true');
    expect(container.getAttribute('data-parity-id')).toBe('dash-widget-tools');
    // Never Sort, New or Settings on a phone.
    expect(screen.queryByTestId('database-actions-sort')).toBeNull();
    expect(screen.queryByTestId('database-template-split-button')).toBeNull();
    expect(screen.queryByTestId('dashboard-widget-settings-button')).toBeNull();
    container.querySelectorAll('[data-widget-tool] button').forEach((button) => {
      expect(button.className).toContain('before:-inset-2');
      expect(button.className).toContain('h-6');
    });
  });

  it('gives a reader who cannot change the conditions of a chart no tools', () => {
    mockLayout = DatabaseViewLayout.Chart;
    mockConditionsReadOnly = true;
    render(<PhoneWidget />);

    expect(screen.queryByTestId('database-actions')).toBeNull();
  });

  it('opens the widget filter panel in a "Filter" sheet that starts on the property picker without a rule', async () => {
    render(<PhoneWidget />);
    fireEvent.click(screen.getByTestId('database-actions-filter'));

    const sheet = screen.getByTestId('mobile-sheet');

    expect(sheet.getAttribute('data-sheet')).toBe('widget-filter');
    expect(within(sheet).getByTestId('mobile-sheet-title').textContent).toBe('Filter');
    expect(within(sheet).getByTestId('dashboard-widget-filters-panel')).toBeTruthy();
    expect(screen.getByTestId('filter-panel-state').textContent).toBe('open');
    // The picker opens once the sheet is up (the next frame).
    fireEvent.click(await screen.findByTestId('pick-property'));
    expect(mockAddFilter).toHaveBeenCalledWith('field-1');

    fireEvent.click(within(sheet).getByTestId('mobile-sheet-close'));
    await waitFor(() => expect(screen.queryByTestId('mobile-sheet')).toBeNull());
    expect(screen.getByTestId('filter-panel-state').textContent).toBe('closed');
  });

  it('lists the rules, highlights the tool and opens on them when the widget has filters', async () => {
    mockFilters = [{ id: 'f1' }];
    render(<PhoneWidget />);
    const filterTool = screen.getByTestId('database-actions-filter');

    expect(filterTool.getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('database-actions').getAttribute('data-has-active')).toBe('true');
    fireEvent.click(filterTool);
    expect(within(screen.getByTestId('mobile-sheet')).getAllByTestId('filter-chip')).toHaveLength(1);
    // Rules exist: no picker on top of them.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.queryByTestId('pick-property')).toBeNull();
  });

  it('expands Search over the title, commits the query after 300ms, and clears back to the title', () => {
    jest.useFakeTimers();
    try {
      render(<PhoneWidget />);
      fireEvent.click(screen.getByTestId('database-actions-search'));

      const header = screen.getByTestId('dashboard-widget-header');

      expect(header.getAttribute('data-search-active')).toBe('true');
      expect(screen.queryByTestId('dashboard-widget-title-button')).toBeNull();
      // The field takes the header; only Filter stays beside it.
      expect(tools()).toEqual(['filter']);
      const field = screen.getByTestId('database-actions-search-field');
      const input = screen.getByTestId('database-actions-search-input');

      expect(field.getAttribute('data-mobile')).toBe('true');
      expect(field.className).toContain('h-8');
      expect(field.className).toContain('flex-1');
      expect(input.className).toContain('text-base');
      expect(input.getAttribute('enterkeyhint')).toBe('search');
      expect(input.getAttribute('placeholder')).toBe('Type to search...');
      expect(document.activeElement).toBe(input);

      fireEvent.change(input, { target: { value: ' launch ' } });
      act(() => {
        jest.advanceTimersByTime(299);
      });
      expect(screen.getByTestId('search-query').textContent).toBe('');
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('search-query').textContent).toBe('launch');

      // A query keeps the field open when it loses the focus.
      fireEvent.blur(input);
      expect(screen.getByTestId('database-actions-search-field')).toBeTruthy();

      fireEvent.click(screen.getByTestId('database-actions-search-clear'));
      expect(screen.getByTestId('search-query').textContent).toBe('');
      expect(screen.queryByTestId('database-actions-search-field')).toBeNull();
      expect(screen.getByTestId('dashboard-widget-title-button')).toBeTruthy();
      expect(screen.getByTestId('dashboard-widget-header').getAttribute('data-search-active')).toBeNull();
      expect(tools()).toEqual(['search', 'filter']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('collapses an empty field on blur and a typed one on Escape', () => {
    render(<PhoneWidget />);
    fireEvent.click(screen.getByTestId('database-actions-search'));
    fireEvent.blur(screen.getByTestId('database-actions-search-input'));
    expect(screen.queryByTestId('database-actions-search-field')).toBeNull();

    fireEvent.click(screen.getByTestId('database-actions-search'));
    const input = screen.getByTestId('database-actions-search-input');

    fireEvent.change(input, { target: { value: 'api' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('database-actions-search-field')).toBeNull();
    expect(screen.getByTestId('search-query').textContent).toBe('');
  });

  it('puts the search field in the capsule when titles are hidden', () => {
    render(<PhoneWidget showWidgetTitles={false} />);
    fireEvent.click(screen.getByTestId('database-actions-search'));

    const capsule = screen.getByTestId('dashboard-widget-tool-capsule');

    expect(capsule.getAttribute('data-search-active')).toBe('true');
    expect(within(capsule).getByTestId('database-actions-search-field')).toBeTruthy();
  });
});
