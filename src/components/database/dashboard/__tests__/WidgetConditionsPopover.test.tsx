import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode, useCallback, useMemo, useState } from 'react';

import {
  DatabaseConditionsActionsContext,
  DatabaseConditionsContext,
  useConditionsContext,
} from '@/components/database/components/conditions/context';

import { WidgetFilterTool } from '../widget-tool-buttons/WidgetFilterTool';
import { WidgetSortTool } from '../widget-tool-buttons/WidgetSortTool';
import { WidgetContext } from '../WidgetContext';

import { createWidgetContextValue } from './dashboardTestHarness';

let mockFilters: { id: string }[] = [];
let mockSorts: { id: string; fieldId: string }[] = [];
const mockAddFilter = jest.fn(() => 'new-filter');
const mockAddSort = jest.fn();
const mockDeleteAllSorts = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
  useFiltersSelector: () => mockFilters,
  useSortsSelector: () => mockSorts,
  useAdvancedFiltersSelector: () => [],
  useConditionsReadOnly: () => false,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useAddFilter: () => mockAddFilter,
  useAddAdvancedFilterAndRebuild: () => jest.fn(),
  useAddSort: () => mockAddSort,
  useClearSortingDispatch: () => mockDeleteAllSorts,
}));

// The property picker: its trigger, and a property to pick while it is open.
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
  default: function FilterChip({ filterId }: { filterId: string }) {
    const context = useConditionsContext();

    return <div data-editor-open={String(context?.openFilterId === filterId)} data-testid='filter-chip' />;
  },
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

const WIDGET = createWidgetContextValue();

/**
 * The conditions context of a dashboard widget, as `DatabaseViews`
 * (`WidgetConditionsProvider`) maps it: the bar's "expand" and the sort menu
 * are the widget's popovers.
 */
function WidgetConditions({ children }: { children: ReactNode }) {
  const [popover, setPopover] = useState<'filters' | 'sorts' | null>(null);
  const [openFilterId, setOpenFilterId] = useState<string>();
  const setExpanded = useCallback(
    (expanded: boolean) => setPopover((current) => (expanded ? 'filters' : current === 'filters' ? null : current)),
    []
  );
  const setSortMenuOpen = useCallback(
    (open: boolean) => setPopover((current) => (open ? 'sorts' : current === 'sorts' ? null : current)),
    []
  );
  const value = useMemo(
    () => ({
      expanded: popover === 'filters',
      toggleExpanded: () => setPopover((current) => (current === 'filters' ? null : 'filters')),
      setExpanded,
      openFilterId,
      setOpenFilterId,
      isAdvancedMode: false,
      setAdvancedMode: jest.fn(),
      advancedPanelOpen: false,
      setAdvancedPanelOpen: jest.fn(),
      sortMenuOpen: popover === 'sorts',
      setSortMenuOpen,
    }),
    [openFilterId, popover, setExpanded, setSortMenuOpen]
  );

  return (
    <WidgetContext.Provider value={WIDGET}>
      <DatabaseConditionsContext.Provider value={value}>
        <DatabaseConditionsActionsContext.Provider
          value={{
            setExpanded,
            setOpenFilterId,
            setAdvancedMode: jest.fn(),
            setAdvancedPanelOpen: jest.fn(),
            setSortMenuOpen,
          }}
        >
          <output data-testid='popover-state'>{popover ?? 'none'}</output>
          {children}
          <button data-testid='column-header-filter' onClick={() => setExpanded(true)} type='button' />
        </DatabaseConditionsActionsContext.Provider>
      </DatabaseConditionsContext.Provider>
    </WidgetContext.Provider>
  );
}

const filterTool = () => screen.getByTestId('database-actions-filter');
const sortTool = () => screen.getByTestId('database-actions-sort');

beforeEach(() => {
  mockFilters = [];
  mockSorts = [];
  jest.clearAllMocks();
});

describe('the widget filter tool', () => {
  it('picks a property first, then opens the Filters popover with the new rule editing', async () => {
    const { rerender } = render(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    expect(filterTool().getAttribute('data-active')).toBe('false');
    fireEvent.click(filterTool());
    expect(screen.queryByTestId('dashboard-widget-filters-popover')).toBeNull();

    mockFilters = [{ id: 'new-filter' }];
    fireEvent.click(screen.getByTestId('pick-property'));
    rerender(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    expect(mockAddFilter).toHaveBeenCalledWith('field-1');
    const popover = await screen.findByTestId('dashboard-widget-filters-popover');

    expect(popover.textContent).toContain('Filters');
    // The 300px popover the parity probe measures.
    expect(popover.getAttribute('data-parity-id')).toBe('dash-widget-filters-popover');
    expect(screen.getByTestId('filter-chip').getAttribute('data-editor-open')).toBe('true');
    expect(screen.getByTestId('database-add-filter-button')).toBeTruthy();
  });

  it('toggles the popover when the widget has rules, and marks the tool active', async () => {
    mockFilters = [{ id: 'f1' }];
    render(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    expect(filterTool().getAttribute('data-active')).toBe('true');
    fireEvent.click(filterTool());
    expect(await screen.findByTestId('dashboard-widget-filters-popover')).toBeTruthy();
    expect(screen.getAllByTestId('filter-chip')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('dashboard-widget-filters-popover-close'));
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-filters-popover')).toBeNull());
    expect(screen.getByTestId('popover-state').textContent).toBe('none');
    // Closed, the tool still shows its rules in the accent.
    expect(filterTool().getAttribute('data-active')).toBe('true');
  });

  it('closes with Escape and gives the focus back to the tool', async () => {
    mockFilters = [{ id: 'f1' }];
    render(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    fireEvent.click(filterTool());
    const popover = await screen.findByTestId('dashboard-widget-filters-popover');

    fireEvent.keyDown(popover, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-filters-popover')).toBeNull());
    expect(document.activeElement).toBe(filterTool());
  });

  it('never opens by itself when a first rule arrives from elsewhere', () => {
    const { rerender } = render(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    mockFilters = [{ id: 'remote' }];
    rerender(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    expect(screen.getByTestId('popover-state').textContent).toBe('none');
    expect(screen.queryByTestId('dashboard-widget-filters-popover')).toBeNull();
  });

  it('opens from the other entry points of the conditions bar (a column header "Filter")', async () => {
    mockFilters = [{ id: 'f1' }];
    render(
      <WidgetConditions>
        <WidgetFilterTool />
      </WidgetConditions>
    );

    act(() => screen.getByTestId('column-header-filter').click());
    expect(await screen.findByTestId('dashboard-widget-filters-popover')).toBeTruthy();
  });
});

describe('the widget sort tool', () => {
  it('picks a property first, then opens the Sorts popover', async () => {
    render(
      <WidgetConditions>
        <WidgetSortTool />
      </WidgetConditions>
    );

    fireEvent.click(sortTool());
    fireEvent.click(screen.getByTestId('pick-property'));

    expect(mockAddSort).toHaveBeenCalledWith('field-1');
    const popover = await screen.findByTestId('dashboard-widget-sorts-popover');

    expect(popover.textContent).toContain('Sorts');
    expect(screen.getByTestId('sort-list')).toBeTruthy();
    expect(screen.getByTestId('popover-state').textContent).toBe('sorts');
  });

  it('toggles the Sorts popover when the widget is sorted, and deleting every sort closes it', async () => {
    mockSorts = [{ id: 's1', fieldId: 'title' }];
    render(
      <WidgetConditions>
        <WidgetSortTool />
      </WidgetConditions>
    );

    expect(sortTool().getAttribute('data-active')).toBe('true');
    fireEvent.click(sortTool());
    expect(await screen.findByTestId('dashboard-widget-sorts-popover')).toBeTruthy();

    fireEvent.click(screen.getByTestId('database-delete-all-sorts-button'));
    expect(mockDeleteAllSorts).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-sorts-popover')).toBeNull());
  });

  it('opens one popover at a time', async () => {
    mockFilters = [{ id: 'f1' }];
    mockSorts = [{ id: 's1', fieldId: 'title' }];
    render(
      <WidgetConditions>
        <WidgetFilterTool />
        <WidgetSortTool />
      </WidgetConditions>
    );

    act(() => screen.getByTestId('column-header-filter').click());
    expect(await screen.findByTestId('dashboard-widget-filters-popover')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('dashboard-widget-filters-popover'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-widget-filters-popover')).toBeNull());

    fireEvent.click(sortTool());
    expect(await screen.findByTestId('dashboard-widget-sorts-popover')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-widget-filters-popover')).toBeNull();
  });
});
