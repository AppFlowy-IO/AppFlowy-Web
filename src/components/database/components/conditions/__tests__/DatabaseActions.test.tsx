import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useDatabase, useDatabaseContext, useDatabaseViewLayout, useReadOnly } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';

import { DatabaseActions } from '../DatabaseActions';

jest.mock('@/application/database-yjs', () => {
  const useReadOnly = jest.fn();

  return {
    useDatabase: jest.fn(),
    useDatabaseContext: jest.fn(),
    useDatabaseViewLayout: jest.fn(),
    useReadOnly,
    // Outside a dashboard widget the conditions follow the real read-only flag.
    useConditionsReadOnly: () => {
      const readOnly = useReadOnly();

      return mockConditionsReadOnly ?? readOnly;
    },
    useFiltersSelector: () => mockFilters,
    useSortsSelector: () => mockSorts,
  };
});

// A dashboard widget's header reads its widget (Edit mode, menu and settings state).
let mockWidget: Record<string, unknown> | null = null;
let mockFilters: { id: string }[] = [];
let mockSorts: { id: string }[] = [];
let mockConditionsReadOnly: boolean | undefined;

jest.mock('@/components/database/dashboard/WidgetContext', () => ({
  useWidgetContextOptional: () => mockWidget,
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
  default: ({ compact, presentation, variant }: { compact?: boolean; presentation?: string; variant?: string }) => (
    <div
      data-compact={String(Boolean(compact))}
      data-presentation={presentation}
      data-testid='filters-button'
      data-variant={variant}
    />
  ),
}));

jest.mock('@/components/database/components/conditions/SortsButton', () => ({
  __esModule: true,
  default: ({ compact, presentation, variant }: { compact?: boolean; presentation?: string; variant?: string }) => (
    <div
      data-compact={String(Boolean(compact))}
      data-presentation={presentation}
      data-testid='sorts-button'
      data-variant={variant}
    />
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

jest.mock('@/components/database/dashboard/DashboardActions', () => ({
  __esModule: true,
  default: () => <div data-testid='dashboard-toolbar' />,
  DashboardActions: () => <div data-testid='dashboard-toolbar' />,
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseDatabase = useDatabase as jest.MockedFunction<typeof useDatabase>;
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
    mockUseDatabase.mockReturnValue(undefined);
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
    ['feed', DatabaseViewLayout.Feed],
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

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Feed);
    rerender(<DatabaseActions />);

    expect(screen.getByTestId('sorts-button')).toBeTruthy();
  });

  it('matches the Desktop Feed setting bar: filter, sort, search, settings, and New', () => {
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Feed);

    render(<DatabaseActions />);

    expect(screen.getByTestId('filters-button').getAttribute('data-compact')).toBe('true');
    expect(screen.getByTestId('sorts-button').getAttribute('data-compact')).toBe('true');
    expect(screen.getByTestId('database-actions-search')).toBeTruthy();
    expect(
      screen
        .getByTestId('database-actions-settings')
        .closest('[data-database-settings-layout]')
        ?.getAttribute('data-database-settings-layout')
    ).toBe(String(DatabaseViewLayout.Feed));
    expect(screen.getByTestId('database-template-button')).toBeTruthy();
  });

  it('keeps only Search in a read-only standalone Feed', () => {
    mockUseReadOnly.mockReturnValue(true);
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Feed);

    render(<DatabaseActions />);

    expect(screen.queryByTestId('filters-button')).toBeNull();
    expect(screen.queryByTestId('sorts-button')).toBeNull();
    expect(screen.queryByTestId('database-template-button')).toBeNull();
    expect(screen.getByTestId('database-actions-search')).toBeTruthy();
  });

  it.each([
    [DatabaseViewLayout.Grid, false],
    [DatabaseViewLayout.Board, false],
    [DatabaseViewLayout.List, false],
    [DatabaseViewLayout.Calendar, false],
    [DatabaseViewLayout.Chart, false],
    [DatabaseViewLayout.Gallery, true],
    [DatabaseViewLayout.Feed, true],
  ])('historical layout %s exposes search only when it consumes the query', (layout, searchable) => {
    mockUseReadOnly.mockReturnValue(true);
    mockUseDatabaseViewLayout.mockReturnValue(layout);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'historical-view', isDocumentBlock: false, dataSource: { type: 'history' },
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(Boolean(screen.queryByTestId('database-actions-search'))).toBe(searchable);
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

  it('resolves the source view before opening a linked database as a page', async () => {
    const getViewIdFromDatabaseId = jest.fn().mockResolvedValue('source-database-view');
    const navigateToView = jest.fn().mockResolvedValue(undefined);

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
    mockUseDatabase.mockReturnValue({
      get: jest.fn().mockReturnValue('source-database-id'),
    } as ReturnType<typeof useDatabase>);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'linked-view',
      databasePageId: 'embedded-linked-view',
      getViewIdFromDatabaseId,
      isDocumentBlock: true,
      navigateToView,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    fireEvent.click(screen.getByTestId('database-actions-open-as-page'));

    await waitFor(() => {
      expect(getViewIdFromDatabaseId).toHaveBeenCalledWith('source-database-id');
      expect(navigateToView).toHaveBeenCalledWith('source-database-view');
    });
    expect(navigateToView).not.toHaveBeenCalledWith('embedded-linked-view');
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

  it('restores an active Gallery query visibly after a layout round trip', () => {
    jest.useFakeTimers();
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);
    const createActions = () => (
      <DatabaseSearchProvider activeViewId='view-1'>
        <DatabaseActions />
        <SearchQueryProbe />
      </DatabaseSearchProvider>
    );
    const { rerender } = render(createActions());

    fireEvent.click(screen.getByTestId('database-actions-search'));
    fireEvent.change(screen.getByTestId('database-actions-search-input'), { target: { value: 'Roadmap' } });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByTestId('database-search-query').textContent).toBe('Roadmap');

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Board);
    rerender(createActions());
    expect(screen.queryByTestId('database-actions-search-input')).toBeNull();

    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);
    rerender(createActions());
    expect(screen.getByTestId('database-actions-search-input').value).toBe('Roadmap');
    expect(screen.getByTestId('database-search-query').textContent).toBe('Roadmap');
  });
});

describe('DatabaseActions in dashboards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabase.mockReturnValue(undefined);
    mockUseReadOnly.mockReturnValue(false);
    mockWidget = null;
    mockFilters = [];
    mockSorts = [];
    mockConditionsReadOnly = undefined;
  });

  function widgetContext(overrides: Record<string, unknown> = {}) {
    return {
      widgetId: 'w1',
      editing: false,
      menuOpen: false,
      settingsOpen: false,
      setSettingsOpen: jest.fn(),
      actions: { openSettings: jest.fn() },
      ...overrides,
    };
  }

  function widgetTools() {
    return Array.from(screen.getByTestId('database-actions').querySelectorAll('[data-widget-tool]')).map(
      (slot) => slot.getAttribute('data-widget-tool')
    );
  }

  function toolbarTestIds() {
    return Array.from(screen.getByTestId('database-actions').querySelectorAll('[data-testid]')).map((element) =>
      element.getAttribute('data-testid')
    );
  }

  it('replaces the view conditions of a dashboard with its own toolbar (which holds Settings)', async () => {
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Dashboard);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'dashboard-view',
      isDocumentBlock: false,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);
    // The dashboard toolbar is loaded lazily.
    await screen.findByTestId('dashboard-toolbar');

    expect(toolbarTestIds()).toEqual(['dashboard-toolbar']);
    expect(screen.getByTestId('database-actions').getAttribute('data-dashboard-widget')).toBeNull();
  });

  describe('in a mobile context', () => {
    const initialWidth = window.innerWidth;

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: initialWidth });
    });

    it('offers an editor of a dashboard no Settings, only the dashboard toolbar (view-only)', async () => {
      mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Dashboard);
      mockUseDatabaseContext.mockReturnValue({
        activeViewId: 'dashboard-view',
        isDocumentBlock: false,
      } as ReturnType<typeof useDatabaseContext>);

      render(<DatabaseActions />);
      await screen.findByTestId('dashboard-toolbar');

      expect(toolbarTestIds()).toEqual(['dashboard-toolbar']);
    });

    it('keeps Settings for the other layouts', () => {
      mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
      mockUseDatabaseContext.mockReturnValue({
        activeViewId: 'grid-view',
        isDocumentBlock: false,
      } as ReturnType<typeof useDatabaseContext>);

      render(<DatabaseActions />);

      expect(screen.getByTestId('database-actions-settings')).toBeTruthy();
    });
  });

  it('still offers the dashboard toolbar (global filters) to read-only viewers', async () => {
    mockUseReadOnly.mockReturnValue(true);
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Dashboard);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'dashboard-view',
      isDocumentBlock: false,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);
    await screen.findByTestId('dashboard-toolbar');

    expect(toolbarTestIds()).toEqual(['dashboard-toolbar']);
  });

  it('shows the Filter and Sort tools of a grid widget in View mode, as popovers, without open-as-page', () => {
    mockWidget = widgetContext();
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'grid-view',
      databasePageId: 'grid-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
      navigateToView: jest.fn(),
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(toolbarTestIds()).toEqual(['filters-button', 'sorts-button']);
    expect(widgetTools()).toEqual(['filter', 'sort']);
    const tools = screen.getByTestId('database-actions');

    expect(tools.getAttribute('data-dashboard-widget')).toBe('true');
    expect(tools.getAttribute('data-force-visible')).toBe('false');
    expect(tools.getAttribute('data-has-active')).toBe('false');
    expect(tools.className).toContain('gap-0.5');
    // At rest in View mode the whole group is transparent (dash-widget-tools opacity 0, 150ms fade).
    expect(tools.className).toContain('opacity-0');
    expect(tools.className).toContain('duration-150');
    expect(tools.className).toContain('group-hover/widget:opacity-100');
    for (const testId of ['filters-button', 'sorts-button']) {
      expect(screen.getByTestId(testId).getAttribute('data-presentation')).toBe('popover');
      expect(screen.getByTestId(testId).getAttribute('data-variant')).toBe('widget');
    }

    expect(screen.queryByTestId('database-actions-open-as-page')).toBeNull();
    expect(screen.queryByTestId('database-actions-settings')).toBeNull();
  });

  it('adds the Settings tool in Edit mode and keeps every tool shown', () => {
    const actions = { openSettings: jest.fn() };

    mockWidget = widgetContext({ editing: true, actions });
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'grid-view',
      databasePageId: 'grid-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(toolbarTestIds()).toEqual(['filters-button', 'sorts-button', 'dashboard-widget-settings-button']);
    expect(screen.getByTestId('database-actions').getAttribute('data-force-visible')).toBe('true');
    const settings = screen.getByTestId('dashboard-widget-settings-button');

    expect(settings.getAttribute('aria-label')).toBe('dashboard.widget.settings');
    expect(settings.getAttribute('data-state')).toBe('closed');
    fireEvent.click(settings);
    expect(actions.openSettings).toHaveBeenCalledTimes(1);
  });

  it('marks an active filter or sort slot so it stays shown at rest', () => {
    mockWidget = widgetContext();
    mockFilters = [{ id: 'f1' }];
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Grid);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'grid-view',
      databasePageId: 'grid-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);
    const slots = Array.from(screen.getByTestId('database-actions').querySelectorAll('[data-widget-tool]'));

    expect(slots.map((slot) => slot.getAttribute('data-active'))).toEqual(['true', 'false']);
    // The group stays visible for the active tool.
    expect(screen.getByTestId('database-actions').getAttribute('data-has-active')).toBe('true');
    expect(screen.getByTestId('database-actions').className).toContain('data-[has-active=true]:opacity-100');
    // Hidden tools keep their slot: only the opacity changes, never the pointer.
    expect(slots[1].className).toContain('opacity-0');
    expect(slots[1].className).toContain('group-hover/widget:opacity-100');
    expect(slots[1].className).toContain('data-[active=true]:opacity-100');
    expect(slots[1].className).not.toContain('pointer-events-none');
  });

  it('shows the tools while the widget menu or the settings host is open', () => {
    mockWidget = widgetContext({ menuOpen: true });
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Chart);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'chart-view',
      databasePageId: 'chart-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(widgetTools()).toEqual(['filter']);
    expect(screen.getByTestId('database-actions').getAttribute('data-force-visible')).toBe('true');
  });

  it('leaves search and the template button out of a gallery widget header', () => {
    mockWidget = widgetContext({ editing: true });
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Gallery);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'gallery-view',
      databasePageId: 'gallery-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(
      <DatabaseSearchProvider activeViewId='gallery-view'>
        <DatabaseActions />
      </DatabaseSearchProvider>
    );

    expect(screen.queryByTestId('database-actions-search')).toBeNull();
    expect(screen.queryByTestId('database-template-button')).toBeNull();
    expect(screen.getByTestId('filters-button')).toBeTruthy();
    expect(screen.getByTestId('dashboard-widget-settings-button')).toBeTruthy();
  });

  it('offers no tool in a published (read-only) widget', () => {
    mockWidget = widgetContext();
    mockUseReadOnly.mockReturnValue(true);
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Board);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'board-view',
      databasePageId: 'board-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(screen.queryByTestId('database-actions')).toBeNull();
    expect(screen.queryByTestId('database-actions-open-as-page')).toBeNull();
  });

  it('keeps the Filter tool for a reader who edits their own conditions', () => {
    mockWidget = widgetContext();
    mockUseReadOnly.mockReturnValue(true);
    mockConditionsReadOnly = false;
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Board);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'board-view',
      databasePageId: 'board-view',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(widgetTools()).toEqual(['filter']);
  });

  it('never renders the dashboard toolbar inside a widget', () => {
    mockUseDatabaseViewLayout.mockReturnValue(DatabaseViewLayout.Dashboard);
    mockUseDatabaseContext.mockReturnValue({
      activeViewId: 'nested-dashboard',
      databasePageId: 'nested-dashboard',
      isDocumentBlock: true,
      isDashboardWidget: true,
    } as ReturnType<typeof useDatabaseContext>);

    render(<DatabaseActions />);

    expect(screen.queryByTestId('dashboard-toolbar')).toBeNull();
  });
});
