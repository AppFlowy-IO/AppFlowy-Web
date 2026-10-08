import { act, fireEvent, render, screen } from '@testing-library/react';

import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';
import { TooltipProvider } from '@/components/ui/tooltip';

import { createAddWidgetFlowStore, createInertAddWidgetApi } from '../add-widget-api';
import { AddWidgetFlowEvent, AddWidgetFlowState } from '../add-widget-flow';
import { HostViewEntry } from '../picker-sections';
import { WidgetAddPicker } from '../WidgetAddPicker';

let mockExperimentalDatabaseViewCreationEnabled = false;
let mockHostViews: HostViewEntry[] = [];
let mockCatalog: WorkspaceDatabaseWithViews[] = [];
let mockTimelineReason: string | undefined;
const mockCatalogEnabled = jest.fn();
const mockDispatch = jest.fn<void, [AddWidgetFlowEvent]>();
const mockCreateInDatabase = jest.fn();

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockExperimentalDatabaseViewCreationEnabled;
  },
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabase: () => undefined,
  useDatabaseContext: () => ({
    activeViewId: 'dash',
    workspaceId: 'workspace',
    createDatabaseView: jest.fn(),
    loadView: jest.fn(),
    databaseDoc: undefined,
  }),
}));

jest.mock('../../DashboardContext', () => ({
  useDashboardContext: () => ({ hostDatabaseId: 'host-db', dashboardViewId: 'dash' }),
  useDashboardLayout: () => ({ hostViewIds: ['g', 'a', 'b', 'c', 'd', 'e', 'f', 'host-timeline'], rows: [] }),
  useDashboardSources: () => ({ sourceDocs: {}, sourceNames: {} }),
}));

jest.mock('../../DashboardUiContext', () => ({
  useDashboardHost: () => ({ workspaceId: 'workspace', getSubscriptions: undefined }),
  useDashboardUi: () => ({
    addWidget: {
      ...jest.requireActual('../add-widget-api').createInertAddWidgetApi(),
      flow: { getState: () => ({ kind: 'idle' }), subscribe: () => () => undefined, dispatch: mockDispatch },
      createInDatabase: mockCreateInDatabase,
    },
  }),
}));

jest.mock('../../hooks/useHostViews', () => ({ useHostViews: () => mockHostViews }));
jest.mock('../../hooks/useWidgetSourceName', () => ({ useWidgetSourceName: () => 'Projects' }));
jest.mock('../../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: (_workspaceId: string, enabled: boolean) => {
    mockCatalogEnabled(enabled);
    return { databases: enabled ? mockCatalog : [], loading: false, error: null };
  },
}));
jest.mock('@/components/app/hooks/useTimelineCreationDisabledReason', () => ({
  useTimelineCreationDisabledReason: () => mockTimelineReason,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? '')
      ),
  }),
}));

jest.mock('@/components/_shared/view-icon', () => ({ ViewIcon: () => null }));
jest.mock('@/components/_shared/view-icon/PageIcon', () => ({ __esModule: true, default: () => null }));

const OPEN: AddWidgetFlowState = {
  kind: 'open',
  widgetId: 'w:new',
  viewId: 'c1',
  layout: DatabaseViewLayout.Chart,
  autoNamed: true,
};
const CREATING: AddWidgetFlowState = {
  kind: 'creating',
  widgetId: 'w:new',
  placement: { type: 'new_row' },
  spec: 'chart',
  popoverOpen: true,
};

function hostView(viewId: string, name: string, layout = ViewLayout.Grid): HostViewEntry {
  return { viewId, name, layout, embedded: false };
}

function renderPicker(state: AddWidgetFlowState = OPEN) {
  return render(
    <TooltipProvider>
      <WidgetAddPicker state={state as Extract<AddWidgetFlowState, { kind: 'open' }>} />
    </TooltipProvider>
  );
}

function optionIds() {
  return screen.getAllByTestId('dashboard-widget-picker-option').map((option) => option.getAttribute('data-view-id'));
}

function layoutRows() {
  return screen.queryAllByTestId('dashboard-widget-picker-layout-option').map((row) => row.textContent);
}

it('offers existing views offline with an online-required explanation and no creation choices', () => {
  renderPicker({ kind: 'choosing_existing', widgetId: 'w:offline', placement: { type: 'new_row' }, spec: 'grid' });
  expect(screen.getByRole('status').textContent).toBe('Connect to the internet to create dashboard widget views.');
  expect(layoutRows()).toEqual([]);
  fireEvent.click(screen.getByTestId('dashboard-widget-picker-other-sources'));
  expect(screen.queryByTestId('dashboard-widget-picker-new-in-database')).toBeNull();
  const option = screen.getAllByTestId('dashboard-widget-picker-option')[0];

  fireEvent.click(option);
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_existing', viewId: 'g', databaseId: 'host-db' });
  expect(mockCreateInDatabase).not.toHaveBeenCalled();
});

beforeEach(() => {
  mockExperimentalDatabaseViewCreationEnabled = true;
  mockTimelineReason = undefined;
  mockHostViews = [
    hostView('g', 'Grid'),
    hostView('a', 'Alpha', ViewLayout.Board),
    hostView('b', 'Beta'),
    hostView('c', 'Gamma'),
    hostView('d', 'Delta'),
    hostView('e', 'Epsilon'),
    hostView('f', 'Zeta'),
    hostView('c1', 'Chart', ViewLayout.Chart),
  ];
  mockCatalog = [
    {
      database_id: 'tasks-db',
      views: [
        {
          view_id: 'tasks-container',
          name: 'Tasks',
          layout: ViewLayout.Document,
          is_container: true,
          embedded: false,
          icon: null,
          parent_view_id: null,
        },
        {
          view_id: 'tasks-grid',
          name: 'Tasks Grid',
          layout: ViewLayout.Grid,
          is_container: false,
          embedded: false,
          icon: null,
          parent_view_id: null,
        },
      ],
    },
  ];
  mockDispatch.mockClear();
  mockCatalogEnabled.mockClear();
  mockCreateInDatabase.mockClear();
});

describe('WidgetAddPicker', () => {
  it('focuses its search field and lists the host views, then the New view types', () => {
    renderPicker();

    expect(document.activeElement).toBe(screen.getByTestId('dashboard-widget-picker-search'));
    const sections = screen
      .getAllByTestId('dashboard-widget-picker-section')
      .map((section) => section.getAttribute('data-section'));

    expect(sections).toEqual(['host', 'other', 'new']);
    expect(screen.getAllByTestId('dashboard-widget-picker-section-title')[0].textContent).toBe('Views on Projects');
    // The flow's own view is never offered.
    expect(optionIds()).toEqual(['g', 'a', 'b', 'c', 'd']);
    expect(layoutRows()).toEqual(['Table', 'Board', 'Gallery', 'List', 'Chart', 'Timeline', 'Feed', 'Calendar']);
  });

  it('reveals the rest of a group with Show 2 more', () => {
    renderPicker();
    const more = screen.getByTestId('dashboard-widget-picker-show-more');

    expect(more.textContent).toBe('Show 2 more');
    fireEvent.click(more);
    expect(optionIds()).toEqual(['g', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('loads the catalog only once Other data sources opens', () => {
    renderPicker();

    expect(mockCatalogEnabled).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId('dashboard-widget-picker-other-sources'));
    expect(mockCatalogEnabled).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('dashboard-widget-picker-group').getAttribute('data-database-id')).toBe('tasks-db');
    expect(screen.getByTestId('dashboard-widget-picker-new-in-database').textContent).toBe('New view in Tasks');
  });

  it('keeps every row disabled while the default view is being created, the search typable', () => {
    renderPicker(CREATING);
    const search = screen.getByTestId<HTMLInputElement>('dashboard-widget-picker-search');

    fireEvent.change(search, { target: { value: 'Gr' } });
    expect(search.value).toBe('Gr');
    const option = screen.getAllByTestId('dashboard-widget-picker-option')[0];

    expect(option.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(option);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('swaps the widget to a picked view', () => {
    renderPicker();

    fireEvent.click(screen.getAllByTestId('dashboard-widget-picker-option')[0]);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_existing', viewId: 'g', databaseId: 'host-db' });
  });

  it('picks the first row the search shows on Enter, before the list catches up', () => {
    renderPicker();
    const search = screen.getByTestId('dashboard-widget-picker-search');

    fireEvent.change(search, { target: { value: 'beta' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_existing', viewId: 'b', databaseId: 'host-db' });
  });

  it('turns the widget into a new view type from a New view row, matched by the search', () => {
    renderPicker();
    const search = screen.getByTestId('dashboard-widget-picker-search');

    fireEvent.change(search, { target: { value: 'Bo' } });
    expect(layoutRows()).toEqual(['Board']);
    fireEvent.keyDown(search, { key: 'Enter' });
    // "Alpha" is a board but its name does not match: the Board type is the first row.
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_layout', layout: DatabaseViewLayout.Board });
  });

  it('moves with the arrow keys across every section and wraps around', () => {
    renderPicker();
    const search = screen.getByTestId('dashboard-widget-picker-search');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-view-id')).toBe('g');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Calendar');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-view-id')).toBe('g');
  });

  it('closes from its round close button and goes back from its back button', () => {
    renderPicker();

    fireEvent.click(screen.getByTestId('dashboard-widget-picker-close'));
    fireEvent.click(screen.getByTestId('dashboard-widget-picker-back'));
    expect(mockDispatch.mock.calls).toEqual([[{ type: 'dismiss' }], [{ type: 'back' }]]);
  });

  it('creates a view in another database from New view in {database}', () => {
    renderPicker();

    fireEvent.click(screen.getByTestId('dashboard-widget-picker-other-sources'));
    fireEvent.click(screen.getByTestId('dashboard-widget-picker-new-in-database'));
    const board = screen
      .getAllByTestId('dashboard-widget-picker-layout-option')
      .find((row) => row.getAttribute('data-layout') === String(DatabaseViewLayout.Board));

    fireEvent.click(board as HTMLElement);
    expect(mockCreateInDatabase).toHaveBeenCalledWith('tasks-db', 'tasks-grid', DatabaseViewLayout.Board);
  });

  it('disables Timeline with its reason when the workspace plan refuses it', () => {
    mockTimelineReason = 'Creating a Timeline view requires a Pro workspace.';
    renderPicker();
    const timeline = screen
      .getAllByTestId('dashboard-widget-picker-layout-option')
      .find((row) => row.textContent === 'Timeline') as HTMLElement;

    expect(timeline.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(timeline);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// The four Timeline gate cases of the old picker (`WidgetPickerContent.test.tsx`).
describe('WidgetAddPicker creation gate', () => {
  beforeEach(() => {
    mockExperimentalDatabaseViewCreationEnabled = false;
    mockHostViews = [hostView('host-timeline', 'Project timeline', ViewLayout.Timeline)];
  });

  it('keeps existing Timeline views selectable while experimental creation is disabled', () => {
    renderPicker();

    fireEvent.click(screen.getByTestId('dashboard-widget-picker-option'));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_existing', viewId: 'host-timeline', databaseId: 'host-db' });
  });

  it('hides Timeline creation while allowing supported layouts when the gate is disabled', () => {
    renderPicker();

    expect(layoutRows()).not.toContain('Timeline');
    fireEvent.click(screen.getAllByTestId('dashboard-widget-picker-layout-option')[0]);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_layout', layout: DatabaseViewLayout.Grid });
  });

  it('creates Timeline views when experimental creation is enabled', () => {
    mockExperimentalDatabaseViewCreationEnabled = true;
    renderPicker();
    const timeline = screen
      .getAllByTestId('dashboard-widget-picker-layout-option')
      .find((row) => row.textContent === 'Timeline') as HTMLElement;

    fireEvent.click(timeline);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'pick_layout', layout: DatabaseViewLayout.Timeline });
  });

  it('rejects a Timeline creation when the gate is disabled after rendering', () => {
    mockExperimentalDatabaseViewCreationEnabled = true;
    renderPicker();
    const timeline = screen
      .getAllByTestId('dashboard-widget-picker-layout-option')
      .find((row) => row.textContent === 'Timeline') as HTMLElement;

    mockExperimentalDatabaseViewCreationEnabled = false;
    act(() => {
      fireEvent.click(timeline);
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('add-widget api', () => {
  it('runs the reducer and its effects in the flow store', () => {
    const effects = jest.fn();
    const store = createAddWidgetFlowStore(effects);
    const listener = jest.fn();

    store.subscribe(listener);
    store.dispatch({ type: 'start', placement: { type: 'new_row' }, widgetId: 'w:1', spec: 'grid', refused: null });
    expect(store.getState().kind).toBe('creating');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(effects.mock.calls[0][0].map((effect: { type: string }) => effect.type)).toEqual([
      'pin_edit',
      'create_default_view',
      'select',
      'scroll_to',
    ]);
  });

  it('keeps the newer dock anchor when the pending slot detaches after the widget attached', () => {
    const { dockAnchors } = createInertAddWidgetApi();
    const pendingRef = dockAnchors.anchorRef('w:1');
    const widgetRef = dockAnchors.anchorRef('w:1');
    const pending = document.createElement('span');
    const widget = document.createElement('span');

    pendingRef(pending);
    widgetRef(widget);
    pendingRef(null);
    expect(dockAnchors.get('w:1')).toBe(widget);
    widgetRef(null);
    expect(dockAnchors.get('w:1')).toBeNull();
  });
});
