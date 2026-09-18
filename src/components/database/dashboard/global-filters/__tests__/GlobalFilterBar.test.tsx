import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { YDoc } from '@/application/types';
import type {
  DashboardContextValue,
  DashboardFiltersContextValue,
  DashboardSourcesContextValue,
} from '@/components/database/dashboard/DashboardContext';

import { GlobalFilterBar, GlobalFilterButton } from '../index';

import { createSourceDoc, option, setFieldOptions } from './source-doc.fixture';

/** The three dashboard contexts, served from one object. */
type MockDashboard = DashboardContextValue & DashboardFiltersContextValue & DashboardSourcesContextValue;

let mockContext: MockDashboard | null = null;

jest.mock('@/components/database/dashboard/DashboardContext', () => {
  const required = () => {
    if (!mockContext) throw new Error('DashboardContext is not provided');
    return mockContext;
  };

  return {
    useDashboardContext: required,
    useDashboardFilters: required,
    useDashboardSources: required,
    useDashboardContextOptional: () => mockContext,
  };
});

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => undefined,
}));

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: [], loading: false }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const count = options?.count;
      const template =
        (count === 1 ? options?.defaultValue_one : count !== undefined ? options?.defaultValue_other : undefined) ??
        options?.defaultValue ??
        key;

      return String(template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

const todo = option('o-todo', 'Todo');
const done = option('o-done', 'Done');

function createDocs() {
  return {
    'db-host': createSourceDoc('db-host', [
      { id: 'host-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
      { id: 'host-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, done] },
    ]),
    'db-other': createSourceDoc('db-other', [
      { id: 'other-title', name: 'Title', type: FieldType.RichText, isPrimary: true },
      { id: 'other-state', name: 'State', type: FieldType.SingleSelect, options: [todo, done] },
    ]),
  } as Record<string, YDoc>;
}

const rows: DashboardRow[] = [
  {
    id: 'r:1',
    height: 360,
    widgets: [
      { id: 'w:1', viewId: 'view-host', databaseId: 'db-host', width: 6 },
      { id: 'w:2', viewId: 'view-other', databaseId: 'db-other', width: 6 },
    ],
  },
];

const statusFilter: DashboardGlobalFilter = {
  id: 'gf:status',
  name: 'Status',
  fieldType: FieldType.SingleSelect,
  condition: SelectOptionFilterCondition.OptionIs,
  content: 'o-done',
  targets: { 'db-host': 'host-status', 'db-other': 'other-state' },
};

const nameFilter: DashboardGlobalFilter = {
  id: 'gf:name',
  name: 'Name',
  fieldType: FieldType.RichText,
  condition: TextFilterCondition.TextContains,
  content: '',
  targets: { 'db-host': 'host-name' },
};

function createContext(overrides: Partial<MockDashboard> = {}): MockDashboard {
  const globalFilters = overrides.globalFilters ?? [statusFilter, nameFilter];
  const localGlobalFilters = overrides.localGlobalFilters ?? null;

  return {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db-host',
    hostViewIds: ['view-host', 'dashboard-view'],
    rows,
    showWidgetTitles: true,
    globalFilters,
    effectiveGlobalFilters: localGlobalFilters ?? globalFilters,
    localGlobalFilters,
    setLocalGlobalFilters: jest.fn(),
    localWidgetChanges: 0,
    registerViewOverlay: jest.fn(),
    resetViewOverlays: jest.fn(),
    commitViewOverlays: jest.fn(),
    canEdit: true,
    isEditing: false,
    setEditing: jest.fn(),
    updateSetting: jest.fn(),
    updateRows: jest.fn(),
    sourceDocs: createDocs(),
    registerSourceDoc: jest.fn(),
    sourceNames: { 'db-host': 'Tasks', 'db-other': 'Projects' },
    registerSourceName: jest.fn(),
    ...overrides,
  };
}

afterEach(() => {
  mockContext = null;
});

describe('GlobalFilterBar', () => {
  it('renders nothing outside a dashboard', () => {
    const { container } = render(<GlobalFilterBar />);

    expect(container.innerHTML).toBe('');
  });

  it('is hidden without filters unless the dashboard is being edited', () => {
    mockContext = createContext({ globalFilters: [] });
    const { rerender } = render(<GlobalFilterBar />);

    expect(screen.queryByTestId('dashboard-global-filter-bar')).toBeNull();

    mockContext = { ...mockContext, isEditing: true };
    // The mocked context hooks are not reactive and the bar is memoized: remount it.
    rerender(<GlobalFilterBar key='editing' />);
    expect(screen.getByTestId('dashboard-global-filter-bar')).toBeTruthy();
    expect(screen.getByTestId('dashboard-global-filter-bar-add').textContent).toBe('Add global filter');
  });

  it('renders one chip per filter with its summary and source count', () => {
    mockContext = createContext();
    render(<GlobalFilterBar />);

    const chips = screen.getAllByTestId('dashboard-global-filter-chip');

    expect(chips.map((chip) => chip.getAttribute('data-filter-id'))).toEqual(['gf:status', 'gf:name']);
    expect(within(chips[0]).getByTestId('dashboard-global-filter-chip-label').textContent).toBe(
      'Status: grid.selectOptionFilter.is Done'
    );
    expect(chips[0].getAttribute('data-active')).toBe('true');
    expect(within(chips[0]).getByTestId('dashboard-global-filter-chip-count').textContent).toBe('2');
    expect(within(chips[0]).getByTestId('dashboard-global-filter-chip-count').getAttribute('aria-label')).toBe(
      '2 sources'
    );
    // A text filter without a value does not narrow anything yet.
    expect(within(chips[1]).getByTestId('dashboard-global-filter-chip-label').textContent).toBe('Name');
    expect(chips[1].getAttribute('data-active')).toBe('false');
    expect(within(chips[1]).getByTestId('dashboard-global-filter-chip-count').getAttribute('aria-label')).toBe(
      '1 source'
    );
    expect(screen.queryByTestId('dashboard-global-filter-local-badge')).toBeNull();
    expect(screen.queryByTestId('dashboard-global-filter-bar-add')).toBeNull();
  });

  it('refreshes option names when a source property changes', () => {
    const context = createContext();

    mockContext = context;
    render(<GlobalFilterBar />);

    act(() => {
      setFieldOptions(context.sourceDocs['db-host'], 'host-status', FieldType.SingleSelect, [
        todo,
        { ...done, name: 'Finished' },
      ]);
    });
    expect(screen.getAllByTestId('dashboard-global-filter-chip-label')[0].textContent).toBe(
      'Status: grid.selectOptionFilter.is Finished'
    );
  });

  it('lets writers save or reset local filter changes', () => {
    const local = [{ ...statusFilter, content: 'o-todo' }];

    mockContext = createContext({ localGlobalFilters: local });
    render(<GlobalFilterBar />);

    expect(screen.getByTestId('dashboard-global-filter-local-badge').textContent).toBe(
      'Only you see these filter changes'
    );
    expect(screen.getByTestId('dashboard-global-filter-chip-label').textContent).toBe(
      'Status: grid.selectOptionFilter.is Todo'
    );

    fireEvent.click(screen.getByTestId('dashboard-global-filter-save-for-everybody'));
    expect(mockContext.updateSetting).toHaveBeenCalledWith({ globalFilters: local });
    expect(mockContext.setLocalGlobalFilters).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByTestId('dashboard-global-filter-reset'));
    expect(mockContext.setLocalGlobalFilters).toHaveBeenCalledTimes(2);
    expect(mockContext.updateSetting).toHaveBeenCalledTimes(1);
  });

  it('only offers a reset to readers', () => {
    mockContext = createContext({ canEdit: false, localGlobalFilters: [] });
    render(<GlobalFilterBar />);

    expect(screen.getByTestId('dashboard-global-filter-bar')).toBeTruthy();
    expect(screen.queryAllByTestId('dashboard-global-filter-chip')).toHaveLength(0);
    expect(screen.getByTestId('dashboard-global-filter-reset')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-global-filter-save-for-everybody')).toBeNull();

    fireEvent.click(screen.getByTestId('dashboard-global-filter-reset'));
    expect(mockContext.setLocalGlobalFilters).toHaveBeenCalledWith(null);
  });
});

describe('GlobalFilterButton', () => {
  it('shows the filter count', () => {
    mockContext = createContext();
    render(<GlobalFilterButton />);

    expect(screen.getByTestId('dashboard-global-filter-button').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('dashboard-global-filter-button-badge').textContent).toBe('2');
  });

  it('renders nothing outside a dashboard', () => {
    const { container } = render(<GlobalFilterButton />);

    expect(container.innerHTML).toBe('');
  });
});
