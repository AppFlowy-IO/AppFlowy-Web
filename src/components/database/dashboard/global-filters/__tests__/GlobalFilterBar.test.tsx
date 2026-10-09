import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { YDoc } from '@/application/types';
import type {
  DashboardContextValue,
  DashboardFiltersContextValue,
  DashboardLayoutContextValue,
  DashboardPrivateSummary,
  DashboardSourcesContextValue,
} from '@/components/database/dashboard/DashboardContext';

import { GlobalFilterBar } from '../GlobalFilterBar';
import { GlobalFilterButton } from '../GlobalFilterButton';
import { getPendingGlobalFilterEditor, requestGlobalFilterEditor } from '../pendingEditorStore';
import { globalFilterSourceLines } from '../useGlobalFilterLabel';

import { MOCK_TRANSLATE } from './global-filter-test-context';
import { createSourceDoc, option, setFieldOptions, source } from './source-doc.fixture';

/** The dashboard contexts, served from one object. */
type MockDashboard = DashboardContextValue &
  DashboardLayoutContextValue &
  DashboardFiltersContextValue &
  DashboardSourcesContextValue & { summary: DashboardPrivateSummary };

let mockContext: MockDashboard | null = null;

jest.mock('@/components/database/dashboard/DashboardContext', () => {
  const required = () => {
    if (!mockContext) throw new Error('DashboardContext is not provided');
    return mockContext;
  };

  return {
    useDashboardContext: required,
    useDashboardLayout: required,
    useDashboardFilters: required,
    useDashboardSources: required,
    useDashboardContextOptional: () => mockContext,
    useDashboardPrivateSummary: () => mockContext?.summary,
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

const CLEAN: DashboardPrivateSummary = {
  hasChanges: false,
  canSave: false,
  dirtyGlobalCount: 0,
  dirtyWidgetCount: 0,
  savableWidgetCount: 0,
};

function createContext(overrides: Partial<MockDashboard> = {}): MockDashboard {
  const globalFilters = overrides.globalFilters ?? [statusFilter, nameFilter];

  return {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db-host',
    hostViewIds: ['view-host', 'dashboard-view'],
    rows,
    showWidgetTitles: true,
    showIconsInHeading: false,
    globalFilters,
    effectiveGlobalFilters: overrides.effectiveGlobalFilters ?? globalFilters,
    privateGlobalValues: {},
    dirtyGlobalFilterIds: new Set(),
    setPrivateGlobalValue: jest.fn(),
    saveForEveryone: jest.fn(() => null),
    resetPrivateChanges: jest.fn(),
    getWidgetPrivateParts: jest.fn(),
    getViewOverlay: jest.fn(),
    setViewOverlayWritable: jest.fn(),
    resetViewOverlays: jest.fn(),
    commitViewOverlays: jest.fn(),
    canEdit: true,
    isEditing: false,
    setEditing: jest.fn(),
    mobileContext: false,
    canEnterEdit: overrides.canEdit ?? true,
    pinEditing: jest.fn(),
    updateSetting: jest.fn(),
    updateRows: jest.fn(),
    sourceDocs: createDocs(),
    registerSourceDoc: jest.fn(),
    sourceNames: { 'db-host': 'Tasks', 'db-other': 'Projects' },
    registerSourceName: jest.fn(),
    summary: CLEAN,
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

  it('is hidden without filters, in View and Edit mode, until something is dirty', () => {
    mockContext = createContext({ globalFilters: [] });
    const { rerender } = render(<GlobalFilterBar />);

    expect(screen.queryByTestId('dashboard-global-filter-bar')).toBeNull();

    // The mocked context hooks are not reactive and the bar is memoized: remount it.
    mockContext = { ...mockContext, isEditing: true };
    rerender(<GlobalFilterBar key='editing' />);
    expect(screen.queryByTestId('dashboard-global-filter-bar')).toBeNull();

    mockContext = { ...mockContext, isEditing: false, summary: { ...CLEAN, hasChanges: true, dirtyWidgetCount: 1 } };
    rerender(<GlobalFilterBar key='dirty' />);
    expect(screen.getByTestId('dashboard-global-filter-bar')).toBeTruthy();
  });

  it('renders one pill per filter with its summary, without the default operator', () => {
    mockContext = createContext();
    render(<GlobalFilterBar />);

    const chips = screen.getAllByTestId('dashboard-global-filter-chip');

    expect(chips.map((chip) => chip.getAttribute('data-filter-id'))).toEqual(['gf:status', 'gf:name']);
    expect(within(chips[0]).getByTestId('dashboard-global-filter-chip-label').textContent).toBe('Status: Done');
    expect(chips[0].getAttribute('data-active')).toBe('true');
    expect(chips[0].getAttribute('data-parity-id')).toBe('dash-global-filter-pill');
    // A text filter without a value does not narrow anything yet.
    expect(within(chips[1]).getByTestId('dashboard-global-filter-chip-label').textContent).toBe('Name');
    expect(chips[1].getAttribute('data-active')).toBe('false');
    expect(screen.queryByTestId('dashboard-global-filter-local-badge')).toBeNull();
  });

  it('shows the source count badge only from 2 sources', () => {
    mockContext = createContext();
    render(<GlobalFilterBar />);

    const [status, name] = screen.getAllByTestId('dashboard-global-filter-chip');

    expect(within(status).getByTestId('dashboard-global-filter-chip-count').textContent).toBe('2');
    expect(status.getAttribute('data-source-count')).toBe('2');
    expect(within(name).queryByTestId('dashboard-global-filter-chip-count')).toBeNull();
    expect(name.getAttribute('data-source-count')).toBe('1');
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
    // Merged by name: the other source still calls it Done.
    expect(screen.getAllByTestId('dashboard-global-filter-chip-label')[0].textContent).toBe('Status: Finished, Done');
  });

  it('a dirty chip shows the dot', () => {
    mockContext = createContext({
      dirtyGlobalFilterIds: new Set(['gf:status']),
      summary: { ...CLEAN, hasChanges: true, canSave: true, dirtyGlobalCount: 1 },
    });
    render(<GlobalFilterBar />);

    const [status, name] = screen.getAllByTestId('dashboard-global-filter-chip');

    expect(within(status).getByTestId('dashboard-global-filter-chip-dot')).toBeTruthy();
    expect(status.getAttribute('data-unsaved')).toBe('true');
    expect(within(name).queryByTestId('dashboard-global-filter-chip-dot')).toBeNull();
  });

  it('the bar renders for widget-only changes with controls only', () => {
    mockContext = createContext({
      globalFilters: [],
      canEdit: false,
      summary: { ...CLEAN, hasChanges: true, dirtyWidgetCount: 1 },
    });
    render(<GlobalFilterBar />);

    expect(screen.queryAllByTestId('dashboard-global-filter-chip')).toHaveLength(0);
    expect(screen.queryByTestId('dashboard-global-filter-bar-add')).toBeNull();
    expect(screen.getByTestId('dashboard-private-controls')).toBeTruthy();
  });

  it('lets writers save for everyone or reset', () => {
    mockContext = createContext({ summary: { ...CLEAN, hasChanges: true, canSave: true, dirtyGlobalCount: 1 } });
    render(<GlobalFilterBar />);

    const save = screen.getByTestId('dashboard-global-filter-save-for-everyone');

    expect(save.textContent).toBe('Save for everyone');
    fireEvent.click(save);
    expect(mockContext.saveForEveryone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-reset'));
    expect(mockContext.resetPrivateChanges).toHaveBeenCalledTimes(1);
  });

  it('only offers a reset to readers', () => {
    mockContext = createContext({ canEdit: false, summary: { ...CLEAN, hasChanges: true, dirtyGlobalCount: 1 } });
    render(<GlobalFilterBar />);

    expect(screen.getByTestId('dashboard-global-filter-reset')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-global-filter-save-for-everyone')).toBeNull();
    fireEvent.click(screen.getByTestId('dashboard-global-filter-reset'));
    expect(mockContext.resetPrivateChanges).toHaveBeenCalledTimes(1);
  });

  it('offers a grey "+ Filter" to writers in both modes, never to readers', () => {
    mockContext = createContext();
    const { rerender } = render(<GlobalFilterBar />);
    const add = screen.getByTestId('dashboard-global-filter-bar-add');

    expect(add.textContent).toBe('Filter');
    expect(add.getAttribute('data-parity-id')).toBe('dash-global-filter-add');
    expect(add.className).toContain('text-text-secondary');

    mockContext = { ...mockContext, isEditing: true };
    rerender(<GlobalFilterBar key='editing' />);
    expect(screen.getByTestId('dashboard-global-filter-bar-add')).toBeTruthy();

    mockContext = { ...mockContext, isEditing: false, canEdit: false };
    rerender(<GlobalFilterBar key='reader' />);
    expect(screen.queryByTestId('dashboard-global-filter-bar-add')).toBeNull();
  });

  it('is left-aligned', () => {
    mockContext = createContext();
    render(<GlobalFilterBar />);

    expect(screen.getByTestId('dashboard-global-filter-bar').className).toContain('justify-start');
  });
});

describe('GlobalFilterButton', () => {
  it('colours the icon while a filter is active and shows no count', () => {
    mockContext = createContext();
    const { rerender } = render(<GlobalFilterButton />);
    const button = screen.getByTestId('dashboard-global-filter-button');

    expect(button.getAttribute('data-count')).toBe('1');
    expect(button.className).toContain('text-dash-accent');
    expect(button.textContent).toBe('');
    expect(screen.queryByTestId('dashboard-global-filter-button-badge')).toBeNull();

    mockContext = createContext({ globalFilters: [nameFilter] });
    rerender(<GlobalFilterButton key='inactive' />);
    expect(screen.getByTestId('dashboard-global-filter-button').className).toContain('text-dash-tool-icon');
  });

  it('counts a filter as active through its usable mappings only, as the pill does', () => {
    // Its only mapping points at a property Tasks no longer has: the evaluator skips the filter.
    const orphan: DashboardGlobalFilter = { ...statusFilter, targets: { 'db-host': 'host-deleted' } };

    mockContext = createContext({ globalFilters: [orphan] });
    const { rerender } = render(
      <>
        <GlobalFilterBar />
        <GlobalFilterButton />
      </>
    );
    const button = () => screen.getByTestId('dashboard-global-filter-button');
    const pill = () => screen.getByTestId('dashboard-global-filter-chip');

    expect(button().getAttribute('data-active')).toBe('false');
    expect(button().getAttribute('data-count')).toBe('0');
    expect(button().className).toContain('text-dash-tool-icon');
    expect(pill().getAttribute('data-active')).toBe('false');
    expect(pill().getAttribute('data-source-count')).toBe('0');

    // A source that is not loaded yet is trusted, on the button as on the pill.
    mockContext = createContext({ globalFilters: [{ ...statusFilter, targets: { 'db-later': 'later-status' } }] });
    rerender(
      <>
        <GlobalFilterBar key='trusted-bar' />
        <GlobalFilterButton key='trusted-button' />
      </>
    );
    expect(button().getAttribute('data-active')).toBe('true');
    expect(button().getAttribute('data-count')).toBe('1');
    expect(pill().getAttribute('data-active')).toBe('true');
  });

  it('lists one tooltip line per usable source, told apart by their database when they read the same', () => {
    const lines = globalFilterSourceLines(
      { ...statusFilter, targets: { 'db-host': 'host-status', 'db-other': 'other-status', 'db-gone': 'x' } },
      [
        source('db-host', 'Tasks', [{ id: 'host-status', name: 'Status', type: FieldType.SingleSelect }]),
        source('db-other', 'Tasks', [{ id: 'other-status', name: 'Status', type: FieldType.SingleSelect }]),
        // The property was deleted: the mapping filters nothing and gets no line.
        source('db-gone', 'Archive', []),
      ],
      MOCK_TRANSLATE
    );

    expect(lines).toEqual([
      { databaseId: 'db-host', text: 'Status in Tasks' },
      { databaseId: 'db-other', text: 'Status in Tasks' },
    ]);
  });

  it('the button shows a dot instead of a count', () => {
    mockContext = createContext({ dirtyGlobalFilterIds: new Set(['gf:status']) });
    render(<GlobalFilterButton />);
    const dot = screen.getByTestId('dashboard-global-filter-button-dot');

    expect(dot.getAttribute('data-slot')).toBe('unsaved-dot');
    expect(dot.getAttribute('data-parity-id')).toBe('dash-toolbar-filter__dot');
    expect(dot.className).toContain('bg-dash-unsaved-dot');
  });

  it('hides the button for readers without filters', () => {
    mockContext = createContext({ canEdit: false, globalFilters: [] });
    const { container, rerender } = render(<GlobalFilterButton />);

    expect(container.innerHTML).toBe('');
    mockContext = createContext({ canEdit: false });
    rerender(<GlobalFilterButton key='with-filters' />);
    expect(screen.getByTestId('dashboard-global-filter-button')).toBeTruthy();
  });

  it('renders nothing outside a dashboard', () => {
    const { container } = render(<GlobalFilterButton />);

    expect(container.innerHTML).toBe('');
  });

  // "Filter multiple sources" adds the first filter while the menu is open and
  // goes on to the builder: the popover must outlive the 0 → 1 filter change.
  it('keeps its popover open when the first filter is added from it', async () => {
    mockContext = createContext({ globalFilters: [] });
    const { rerender } = render(<GlobalFilterButton />);
    const button = () => screen.getByTestId('dashboard-global-filter-button');

    fireEvent.click(button());
    await screen.findByTestId('dashboard-global-filter-menu');
    expect(button().getAttribute('data-state')).toBe('open');

    mockContext = createContext({ globalFilters: [nameFilter] });
    rerender(<GlobalFilterButton />);

    expect(screen.getByTestId('dashboard-global-filter-menu')).toBeTruthy();
    expect(button().getAttribute('data-state')).toBe('open');
    expect(button().getAttribute('data-count')).toBe('0');
  });
});

describe('GlobalFilterPopover (one popover for every entry point)', () => {
  const popover = () => document.querySelector<HTMLElement>('[data-parity-id="dash-global-filter-popover"]');

  async function openFrom(trigger: HTMLElement) {
    fireEvent.click(trigger);
    const menu = await screen.findByTestId('dashboard-global-filter-menu');

    return { menu, content: popover()! };
  }

  function close(menu: HTMLElement) {
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(popover()).toBeNull();
  }

  it('opens the requested pill on the next frame after a pick in the menu', async () => {
    mockContext = createContext({ isEditing: true });
    render(<GlobalFilterBar />);
    expect(screen.queryByTestId('dashboard-global-filter-pill-editor')).toBeNull();

    act(() => requestGlobalFilterEditor('gf:name'));

    // Consuming the request must not cancel the frame that opens the pill.
    const editor = await screen.findByTestId('dashboard-global-filter-pill-editor');

    expect(editor.getAttribute('data-filter-id')).toBe('gf:name');
    expect(getPendingGlobalFilterEditor()).toBeNull();
  });

  it("opens the same 290px popover from a pill, the bar's + Filter and the toolbar button", async () => {
    mockContext = createContext({ isEditing: true });
    render(
      <>
        <GlobalFilterBar />
        <GlobalFilterButton />
      </>
    );

    // A pill opens straight on its filter's editor.
    const chip = await openFrom(screen.getAllByTestId('dashboard-global-filter-chip')[0]);

    expect(chip.menu.getAttribute('data-screen')).toBe('pill');
    expect(screen.getByTestId('dashboard-global-filter-pill-editor').getAttribute('data-filter-id')).toBe('gf:status');
    expect(chip.content.style.width).toBe('290px');
    const className = chip.content.className;

    close(chip.menu);

    // "+ Filter" and the toolbar button open on the property picker.
    const add = await openFrom(screen.getByTestId('dashboard-global-filter-bar-add'));

    expect(add.menu.getAttribute('data-screen')).toBe('picker');
    expect(add.content.className).toBe(className);
    close(add.menu);

    const button = await openFrom(screen.getByTestId('dashboard-global-filter-button'));

    expect(button.menu.getAttribute('data-screen')).toBe('picker');
    expect(button.content.style.width).toBe('290px');
    close(button.menu);
  });
});
