import { render, screen } from '@testing-library/react';
import { createRef, ReactNode } from 'react';

import { DatabaseViewLayout, ViewLayout, YDoc } from '@/application/types';

import {
  DashboardFiltersContext,
  DashboardFiltersContextValue,
  DashboardSourceRegistryContext,
  DashboardSourceRegistryContextValue,
} from '../DashboardContext';
import { DashboardHostContext, DashboardHostServices, DashboardUiContext } from '../DashboardUiContext';
import { WidgetFrame } from '../WidgetContext';
import { WidgetDatabaseHost } from '../WidgetDatabaseHost';
import { WidgetContextProvider, WidgetPlaceholderFrame } from '../WidgetFrame';

import {
  createDashboardUiValue,
  createDatabaseDoc as createDatabaseFixture,
  createWidgetActions,
} from './dashboardTestHarness';

const mockLoader = jest.fn();
const mockSourceDocs = new Map<string, YDoc>();
const mockLabels: string[] = [];

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@/application/publish-snapshot/database-yjs-render-bridge', () => ({
  getPublishedDatabaseRenderRowMap: () => undefined,
}));
// The nested database: what the widget hands it.
jest.mock('@/components/database', () => ({
  Database: ({
    activeViewId,
    databaseName,
    embeddedHeight,
  }: {
    activeViewId: string;
    databaseName: string;
    embeddedHeight: number;
  }) => (
    <div
      data-height={embeddedHeight}
      data-name={databaseName}
      data-testid='nested-database'
      data-view-id={activeViewId}
    />
  ),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: (options: { viewId: string; databaseId: string }) => {
    mockLoader(options.viewId, options.databaseId);
    return {
      doc: options.viewId ? mockSourceDocs.get(options.databaseId) ?? null : null,
      notFound: false,
      noAccess: false,
      offline: false,
      setNotFound: jest.fn(),
    };
  },
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: () => 'none',
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: ({
    children,
  }: {
    children: (permissions: { readOnly: boolean; canWrite: boolean; canShare: boolean }) => ReactNode;
  }) => children({ readOnly: false, canWrite: true, canShare: false }),
}));
jest.mock('../hooks/useDashboardDnd', () => ({
  useDraggableWidget: ({ label }: { label: string }) => {
    mockLabels.push(label);
  },
}));
// The header: the title and the layout the widget context gives it.
jest.mock('../WidgetHeader', () => ({
  WidgetHeaderFrame: () => {
    const { useWidgetContext } = jest.requireActual<typeof import('../WidgetContext')>('../WidgetContext');
    const { name, layout } = useWidgetContext();

    return <div data-layout={layout} data-testid='widget-header' title={name} />;
  },
}));

/** A database collab whose views have these names and layouts. */
function createDatabaseDoc(databaseId: string, views: Record<string, { name: string; layout: DatabaseViewLayout }>) {
  return createDatabaseFixture({
    id: databaseId,
    views: Object.entries(views).map(([id, { name, layout }]) => ({ id, name, layout })),
  }).doc;
}

const actions = createWidgetActions();

function createFrame(overrides: Partial<WidgetFrame> = {}): WidgetFrame {
  return {
    widgetId: 'w1',
    databaseId: 'source-db',
    viewId: 'v1',
    folderName: '',
    folderLayout: undefined,
    icon: null,
    isEditing: false,
    canEdit: true,
    editing: false,
    showWidgetTitles: true,
    showIcon: false,
    headerHeight: 40,
    isDragging: false,
    menuOpen: false,
    setMenuOpen: jest.fn(),
    settingsOpen: false,
    setSettingsOpen: jest.fn(),
    getBoxElement: () => null,
    titleRef: createRef(),
    optionsRef: createRef(),
    settingsToolRef: createRef(),
    actions,
    ...overrides,
  };
}

function renderInDashboard(children: ReactNode) {
  const hostDoc = createDatabaseDoc('host-db', { 'host-view': { name: 'Host grid', layout: DatabaseViewLayout.Grid } });
  const release = jest.fn();
  const ui = createDashboardUiValue({ hostDatabaseId: 'host-db', acquireSourceDoc: jest.fn(() => release) });
  const host = { databaseDoc: hostDoc, readOnly: false, workspaceId: 'workspace' } as DashboardHostServices;
  const filters = {
    effectiveGlobalFilters: [],
    getViewOverlay: () => undefined,
    setViewOverlayWritable: jest.fn(),
  } as unknown as DashboardFiltersContextValue;
  const registry = {
    markWidgetShown: () => () => undefined,
    getShownDoc: () => null,
  } as unknown as DashboardSourceRegistryContextValue;

  const rendered = render(
    <DashboardHostContext.Provider value={host}>
      <DashboardUiContext.Provider value={ui}>
        <DashboardFiltersContext.Provider value={filters}>
          <DashboardSourceRegistryContext.Provider value={registry}>{children}</DashboardSourceRegistryContext.Provider>
        </DashboardFiltersContext.Provider>
      </DashboardUiContext.Provider>
    </DashboardHostContext.Provider>
  );

  return { ...rendered, ui, release };
}

const header = () => screen.getByTestId('widget-header');
const placeholder = () => screen.queryByTestId('dashboard-widget-placeholder');

beforeEach(() => {
  mockLoader.mockClear();
  mockSourceDocs.clear();
  mockLabels.length = 0;
  (actions.remove as jest.Mock).mockClear();
});

describe('a widget that waits for its turn (WidgetContextProvider + WidgetPlaceholderFrame, no host)', () => {
  const waiting = (frame: WidgetFrame) => (
    <WidgetContextProvider frame={frame} sourceView={null}>
      <WidgetPlaceholderFrame reason='loading' />
    </WidgetContextProvider>
  );

  it('renders its header and the loading state without loading or mounting its database', () => {
    renderInDashboard(waiting(createFrame({ folderName: 'Roadmap', folderLayout: ViewLayout.Board })));

    expect(header().title).toBe('Roadmap');
    expect(header().dataset.layout).toBe(String(ViewLayout.Board));
    expect(placeholder()?.dataset.reason).toBe('loading');
    expect(screen.queryByTestId('nested-database')).toBeNull();
    expect(mockLoader).not.toHaveBeenCalled();
  });

  it('is named after its layout until anything else is known', () => {
    renderInDashboard(waiting(createFrame()));

    expect(header().title).toBe('Grid');
    expect(header().dataset.layout).toBe(String(ViewLayout.Grid));
  });

  it('never offers to remove a widget that is only loading, even in Edit mode', () => {
    renderInDashboard(waiting(createFrame({ editing: true, isEditing: true })));

    expect(screen.queryByTestId('dashboard-widget-remove-button')).toBeNull();
  });
});

describe('WidgetPlaceholderFrame', () => {
  const broken = (frame: WidgetFrame) => (
    <WidgetContextProvider frame={frame} sourceView={null}>
      <WidgetPlaceholderFrame reason='not-found' />
    </WidgetContextProvider>
  );

  it('offers to remove a broken widget in Edit mode only', () => {
    const view = renderInDashboard(broken(createFrame()));

    expect(placeholder()?.dataset.reason).toBe('not-found');
    expect(screen.queryByTestId('dashboard-widget-remove-button')).toBeNull();
    view.unmount();

    renderInDashboard(broken(createFrame({ editing: true, isEditing: true })));
    screen.getByTestId('dashboard-widget-remove-button').click();
    expect(actions.remove).toHaveBeenCalledTimes(1);
  });
});

describe('WidgetDatabaseHost', () => {
  it('starts the load of another database when it mounts, and shows the loading frame meanwhile', () => {
    renderInDashboard(<WidgetDatabaseHost frame={createFrame({ folderName: 'Roadmap' })} viewportHeight={314} />);

    expect(mockLoader).toHaveBeenCalledWith('v1', 'source-db');
    expect(header().title).toBe('Roadmap');
    expect(placeholder()?.dataset.reason).toBe('loading');
    expect(screen.queryByTestId('nested-database')).toBeNull();
  });

  it('renders the loaded database with the card height, and releases its doc when it unmounts', () => {
    const doc = createDatabaseDoc('source-db', { v1: { name: 'Sprint board', layout: DatabaseViewLayout.Board } });

    mockSourceDocs.set('source-db', doc);
    const { ui, release, unmount } = renderInDashboard(
      <WidgetDatabaseHost frame={createFrame()} viewportHeight={314} />
    );
    const nested = screen.getByTestId('nested-database');

    expect(placeholder()).toBeNull();
    expect(nested.dataset.viewId).toBe('v1');
    expect(nested.dataset.height).toBe('314');
    // The name and the layout stored in the source database complete the frame.
    expect(nested.dataset.name).toBe('Sprint board');
    expect(mockLabels.at(-1)).toBe('Sprint board');
    expect(ui.acquireSourceDoc).toHaveBeenCalledWith('source-db', doc);
    expect(release).not.toHaveBeenCalled();

    unmount();
    expect(release).toHaveBeenCalledTimes(1);
    doc.destroy();
  });

  it('prefers the folder name of the view and the layout stored in its database', () => {
    const doc = createDatabaseDoc('source-db', { v1: { name: 'Stored name', layout: DatabaseViewLayout.Calendar } });

    mockSourceDocs.set('source-db', doc);
    renderInDashboard(
      <WidgetDatabaseHost
        frame={createFrame({ folderName: ' Renamed in the folder ', folderLayout: ViewLayout.Grid })}
        viewportHeight={314}
      />
    );

    expect(screen.getByTestId('nested-database').dataset.name).toBe('Renamed in the folder');
    doc.destroy();
  });

  it('loads nothing for a widget of the host database: its doc is already open', () => {
    const { ui } = renderInDashboard(
      <WidgetDatabaseHost frame={createFrame({ databaseId: 'host-db', viewId: 'host-view' })} viewportHeight={314} />
    );

    // The loader is given no view, which is how it stays idle.
    expect(mockLoader).toHaveBeenCalledWith('', 'host-db');
    expect(screen.getByTestId('nested-database').dataset.name).toBe('Host grid');
    expect(ui.acquireSourceDoc).not.toHaveBeenCalled();
  });

  it('shows the frame placeholder for a dashboard view: dashboards never nest', () => {
    const doc = createDatabaseDoc('source-db', { v1: { name: 'KPIs', layout: DatabaseViewLayout.Dashboard } });

    mockSourceDocs.set('source-db', doc);
    renderInDashboard(<WidgetDatabaseHost frame={createFrame()} viewportHeight={314} />);

    expect(placeholder()?.dataset.reason).toBe('unsupported');
    expect(header().dataset.layout).toBe(String(ViewLayout.Dashboard));
    expect(screen.queryByTestId('nested-database')).toBeNull();
    doc.destroy();
  });
});
