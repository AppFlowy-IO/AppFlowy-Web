import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import {
  moveDashboardRow,
  moveDashboardWidget,
  readDashboardLayoutSetting,
  readStoredDashboardWidgets,
  updateDashboardLayoutSetting,
} from '@/application/database-yjs/dashboard-layout';
import { createOwnedDatabaseView, deleteOwnedDatabaseView } from '@/application/database-yjs/dashboard-owned-view-ops';
import { DASHBOARD_LAYOUT_KEY, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { Dashboard } from '../Dashboard';
import { DASHBOARD_EDIT_ONLY_UPDATE_KEYS, touchesEditOnlyKeys } from '../dashboard-mode';
import { DashboardActions } from '../DashboardActions';
import { DashboardProvider, useDashboardContext } from '../DashboardContext';
import { getWidgetMoveTargets } from '../widget-moves';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? key).replace('{{count}}', String(options?.count ?? '')),
  }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

// Refusals and row moves are announced to assistive technology, never shown.
const mockAnnounce = jest.fn();

jest.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({
  announce: (message: string) => mockAnnounce(message),
  cleanup: () => undefined,
}));

// jsdom computes no Tailwind overflow, so auto-scroll would warn on every mount.
jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: () => () => undefined,
}));

jest.mock('../global-filters/GlobalFilterBar', () => ({
  GlobalFilterBar: () => <div data-testid='global-filter-bar-stub' />,
}));

jest.mock('../global-filters/GlobalFilterButton', () => ({
  GlobalFilterButton: () => <button data-testid='global-filter-button-stub' type='button' />,
}));

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({
    widget,
    span,
    lineSize,
    height,
    showIconsInHeading,
  }: {
    widget: { id: string; viewId: string; databaseId: string };
    span: number;
    lineSize: number;
    height: number;
    showIconsInHeading: boolean;
  }) => {
    const { useDashboardSelectedWidgetId } =
      jest.requireActual<typeof import('../DashboardUiContext')>('../DashboardUiContext');

    return (
      <div
        data-database-id={widget.databaseId}
        data-height={height}
        data-icons={String(showIconsInHeading)}
        data-line-size={lineSize}
        data-selected={String(useDashboardSelectedWidgetId() === widget.id)}
        data-span={span}
        data-testid='dashboard-widget'
        data-view-id={widget.viewId}
        data-widget-id={widget.id}
      />
    );
  },
}));

// The dock: a stand-in for the "New view" picker that drives the add flow like the real one.
jest.mock('../WidgetPicker', () => ({
  preloadWidgetPicker: jest.fn(),
  LazyWidgetDockHost: () => {
    const { useDashboardUi } = jest.requireActual<typeof import('../DashboardUiContext')>('../DashboardUiContext');
    const { useAddWidgetFlowState } =
      jest.requireActual<typeof import('../add-widget/add-widget-api')>('../add-widget/add-widget-api');
    const { isAddWidgetPopoverOpen } = jest.requireActual<typeof import('../add-widget/add-widget-flow')>(
      '../add-widget/add-widget-flow'
    );
    const { flow } = useDashboardUi().addWidget;
    const state = useAddWidgetFlowState(flow, (current) => current);

    if (!isAddWidgetPopoverOpen(state) || state.kind === 'idle') return null;
    return (
      <div
        data-state={state.kind === 'creating' ? 'creating' : 'ready'}
        data-testid='dashboard-widget-picker'
        data-widget-id={state.widgetId}
      >
        <button
          data-testid='pick-tasks'
          onClick={() => flow.dispatch({ type: 'pick_existing', viewId: 'tasks-view', databaseId: 'tasks-db' })}
          type='button'
        />
        <button data-testid='close-picker' onClick={() => flow.dispatch({ type: 'dismiss' })} type='button' />
      </div>
    );
  },
}));

const mockUseWorkspaceDatabases = jest.fn(() => ({ databases: [], loading: false, error: null }));

jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: (workspaceId: string, enabled: boolean) => mockUseWorkspaceDatabases(workspaceId, enabled),
}));

jest.mock('@/components/app/hooks/useSubscriptionPlan', () => ({
  useSubscriptionPlan: () => ({ loadSubscription: async () => 'pro' }),
}));
jest.mock('@/application/workspace-plan-policy', () => ({
  getWorkspacePlanPolicy: () => ({ requiresOnlineViewCreation: () => false, hasProAccess: () => true }),
}));
jest.mock('@/application/database-yjs/dashboard-owned-view-ops', () => ({
  ...jest.requireActual('@/application/database-yjs/dashboard-owned-view-ops'),
  createOwnedDatabaseView: jest.fn(),
  deleteOwnedDatabaseView: jest.fn(),
  repairDashboardOwnerMarkers: jest.fn().mockResolvedValue(0),
}));

const mockCreateView = createOwnedDatabaseView as jest.Mock;
const mockDeleteView = deleteOwnedDatabaseView as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const DATABASE_ID = 'host-database';
const VIEW_ID = 'dashboard-view';

function widget(id: string, width = 12) {
  return { id, viewId: `view-${id}`, databaseId: DATABASE_ID, width };
}

function makeRows(...layout: string[][]): DashboardRow[] {
  return layout.map((ids, index) => ({
    id: `r${index + 1}`,
    height: 360,
    widgets: ids.map((id) => widget(id, 12 / ids.length)),
  }));
}

function createDatabaseDoc(rows: DashboardRow[]) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.views, views as never);
  views.set(VIEW_ID, view);
  doc.transact(() => updateDashboardLayoutSetting(view, { rows }));
  return { doc, database, view, views };
}

function renderDashboard(
  rows: DashboardRow[],
  { readOnly = false, extra }: { readOnly?: boolean; extra?: ReactNode } = {}
) {
  const { doc, database, view, views } = createDatabaseDoc(rows);
  let updates = 0;

  doc.on('update', () => {
    updates += 1;
  });
  const tree = (nextReadOnly: boolean) => {
    const value: DatabaseContextState = {
      readOnly: nextReadOnly,
      databaseDoc: doc,
      databasePageId: VIEW_ID,
      activeViewId: VIEW_ID,
      rowMap: {},
      workspaceId: 'workspace-id',
      deletePage: jest.fn().mockResolvedValue(undefined),
    };

    return (
      <DatabaseContext.Provider value={value}>
        <DashboardProvider>
          <DashboardActions />
          <Dashboard />
          {extra}
        </DashboardProvider>
      </DatabaseContext.Provider>
    );
  };

  const { rerender } = render(tree(readOnly));

  return {
    // The app drops write access while it re-probes permissions (back on the tab, a reconnect).
    setReadOnly: (nextReadOnly: boolean) => rerender(tree(nextReadOnly)),
    persistedRows: () => readDashboardLayoutSetting(database, VIEW_ID).rows,
    /** Every stored widget, the hidden ones beyond the limit included. */
    storedWidgetIds: () => readStoredDashboardWidgets(database, VIEW_ID).map((item) => item.id),
    /** Stores `rows` as another client left them (no limits applied). */
    writeRawRows: (raw: unknown[]) =>
      act(() => {
        doc.transact(() =>
          view.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY)?.set(YjsDatabaseKey.dashboard_rows, raw)
        );
      }),
    /** Writes to the host doc so far (one per layout write). */
    updateCount: () => updates,
    writeRows: (next: DashboardRow[]) =>
      act(() => {
        doc.transact(() => updateDashboardLayoutSetting(view, { rows: next }));
      }),
    /** The default view the server creates for the add flow lands in the host doc, owned by the dashboard. */
    landView: (viewId: string, layout: DatabaseViewLayout, name: string) => {
      const created = new Y.Map() as YDatabaseView;

      doc.transact(() => {
        created.set(YjsDatabaseKey.layout, layout as never);
        created.set(YjsDatabaseKey.name, name);
        created.set(YjsDatabaseKey.dashboard_owner, VIEW_ID);
        views.set(viewId, created);
      }, 'server');
    },
  };
}

function dashboard() {
  return screen.getByTestId('dashboard-view');
}

function rowAddButton(rowId: string) {
  return screen
    .getAllByTestId('dashboard-add-widget-row-button')
    .find((button) => button.getAttribute('data-row-id') === rowId) as HTMLElement;
}

function rowMoves(rowId: string) {
  const row = screen.getAllByTestId('dashboard-row').find((element) => element.dataset.rowId === rowId) as HTMLElement;

  return within(row)
    .queryAllByTestId(/^dashboard-row-move-(up|down)$/)
    .map((button) => button.getAttribute('data-testid')?.replace('dashboard-row-move-', ''));
}

function rowMoveButton(rowId: string, control: 'up' | 'down') {
  return screen
    .getAllByTestId(`dashboard-row-move-${control}`)
    .find((button) => button.getAttribute('data-row-id') === rowId) as HTMLElement;
}

/** Dispatches a row move and a widget-menu move ("Move left" of `b`) through the dashboard's writer. */
function MoveProbe() {
  const { updateRows } = useDashboardContext();

  return (
    <>
      <button
        data-testid='probe-move-row'
        onClick={() => updateRows((rows) => moveDashboardRow(rows, 'r1', 1))}
        type='button'
      />
      <button
        data-testid='probe-move-left'
        onClick={() =>
          updateRows((rows) => {
            const placement = getWidgetMoveTargets(rows, 'b').left;

            return placement ? moveDashboardWidget(rows, 'b', placement) : rows;
          })
        }
        type='button'
      />
    </>
  );
}

function visibleAddWidgetButton() {
  return screen.getByTestId('dashboard-add-widget-button');
}

function resizeTo(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });
}

/** Lets the add flow resolve the plan and the default view (each step is a microtask). */
async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

type Rendered = ReturnType<typeof renderDashboard>;

/** The default view lands in the host doc and resolves (or, with `hold`, waits for `release`). */
function serveDefaultView(rendered: Rendered, { hold = false }: { hold?: boolean } = {}) {
  const pending = deferred<string>();

  mockCreateView.mockImplementationOnce(
    async (_deps: unknown, params: { layout: DatabaseViewLayout; baseName: string }) => {
      if (hold) await pending.promise;
      rendered.landView('default-view', params.layout, params.baseName);
      return 'default-view';
    }
  );
  return { release: () => pending.resolve('default-view') };
}

function picker() {
  return screen.queryByTestId('dashboard-widget-picker');
}

/**
 * No banner: a limit text shows only in the full tooltip of a refused control
 * (refusals are announced to the mocked live region, never rendered).
 */
function expectNoLimitBanner() {
  const shown = screen
    .queryAllByText(/Dashboard is full|Delete a view to add a new one|A row holds up to/)
    .filter((node) => !node.closest('[data-testid="dashboard-full-tooltip"], [role="tooltip"]'));

  expect(shown.map((node) => node.textContent)).toEqual([]);
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockCreateView.mockReset();
    mockDeleteView.mockReset();
    mockDeleteView.mockResolvedValue(undefined);
    mockAnnounce.mockClear();
  });

  describe('an empty dashboard', () => {
    it('opens in Edit mode for editors with the placeholder widget and its New view pill', () => {
      renderDashboard([]);

      expect(dashboard().getAttribute('data-editing')).toBe('true');
      expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
      const empty = screen.getByTestId('dashboard-empty-state');

      expect(empty.getAttribute('data-editing')).toBe('true');
      expect(within(empty).getByTestId('dashboard-empty-placeholder')).toBeTruthy();
      expect(within(empty).getByTestId('dashboard-empty-new-view-button').textContent).toBe('New view');
      expect(screen.getByTestId('global-filter-bar-stub')).toBeTruthy();
    });

    it('inserts the selected default widget from New view, then swaps it to the picked view', async () => {
      const rendered = renderDashboard([]);

      serveDefaultView(rendered);
      fireEvent.click(screen.getByTestId('dashboard-empty-new-view-button'));
      await settle();

      // The default Number widget, persisted under the id the pending slot had.
      const [inserted] = rendered.persistedRows()[0].widgets;

      expect(mockCreateView).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ layout: DatabaseViewLayout.Chart, baseName: 'Chart', owner: VIEW_ID })
      );
      expect(inserted).toEqual({
        id: expect.stringMatching(/^w:/),
        viewId: 'default-view',
        databaseId: DATABASE_ID,
        width: 12,
      });
      expect(picker()?.getAttribute('data-state')).toBe('ready');
      expect(picker()?.getAttribute('data-widget-id')).toBe(inserted.id);
      expect(screen.getByTestId('dashboard-widget').getAttribute('data-selected')).toBe('true');
      expect(screen.queryByTestId('dashboard-empty-state')).toBeNull();

      fireEvent.click(screen.getByTestId('pick-tasks'));

      expect(picker()).toBeNull();
      expect(rendered.persistedRows()[0].widgets).toEqual([
        { ...inserted, viewId: 'tasks-view', databaseId: 'tasks-db' },
      ]);
      expect(screen.getByTestId('dashboard-widget').getAttribute('data-view-id')).toBe('tasks-view');
    });

    it('shows the pending widget with the picker while the default view is created', async () => {
      const rendered = renderDashboard([]);
      const creation = serveDefaultView(rendered, { hold: true });

      fireEvent.click(screen.getByTestId('dashboard-empty-new-view-button'));
      await settle();

      const pending = screen.getByTestId('dashboard-widget-pending');

      expect(pending.getAttribute('data-selected')).toBe('true');
      expect(within(pending).getByTestId('dashboard-widget-title').textContent).toBe('Chart');
      expect(picker()?.getAttribute('data-state')).toBe('creating');
      expect(picker()?.getAttribute('data-widget-id')).toBe(pending.getAttribute('data-widget-id'));
      // Nothing persisted, and the pending slot is no widget of the load queue.
      expect(rendered.persistedRows()).toEqual([]);
      expect(screen.queryByTestId('dashboard-widget')).toBeNull();

      await act(async () => creation.release());
      await settle();
      expect(screen.queryByTestId('dashboard-widget-pending')).toBeNull();
      expect(screen.getByTestId('dashboard-widget').getAttribute('data-widget-id')).toBe(
        pending.getAttribute('data-widget-id')
      );
    });

    it('tells viewers it has no widgets after Done, and offers Edit again', () => {
      renderDashboard([]);

      fireEvent.click(screen.getByTestId('dashboard-done-button'));

      expect(dashboard().getAttribute('data-editing')).toBe('false');
      const empty = screen.getByTestId('dashboard-empty-state');

      expect(empty.textContent).toContain('Add charts, tables, lists');
      expect(within(empty).queryByTestId('dashboard-empty-new-view-button')).toBeNull();

      fireEvent.click(within(empty).getByTestId('dashboard-empty-edit-dashboard-button'));
      expect(dashboard().getAttribute('data-editing')).toBe('true');
    });

    it('returns to View mode when widgets arrive from the server before the editor starts building', () => {
      // A stale local cache can show an empty layout until the server sync lands.
      const { writeRows } = renderDashboard([]);

      expect(dashboard().getAttribute('data-editing')).toBe('true');
      writeRows(makeRows(['a', 'b']));

      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.getAllByTestId('dashboard-widget')).toHaveLength(2);
    });

    it('stays in Edit mode once the editor has started building', async () => {
      const rendered = renderDashboard([]);

      serveDefaultView(rendered, { hold: true });
      fireEvent.click(screen.getByTestId('dashboard-empty-new-view-button'));
      await settle();
      fireEvent.click(screen.getByTestId('close-picker'));
      rendered.writeRows(makeRows(['a']));

      expect(dashboard().getAttribute('data-editing')).toBe('true');
    });

    it('does not force View mode after the editor re-entered Edit mode themselves', () => {
      const { writeRows } = renderDashboard([]);

      fireEvent.click(screen.getByTestId('dashboard-done-button'));
      fireEvent.click(screen.getByTestId('dashboard-empty-edit-dashboard-button'));
      writeRows(makeRows(['a']));

      expect(dashboard().getAttribute('data-editing')).toBe('true');
    });

    it('stays in View mode for read-only viewers', () => {
      renderDashboard([], { readOnly: true });

      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.getByTestId('dashboard-empty-state').textContent).toContain('Add charts, tables, lists');
      expect(screen.queryByTestId('dashboard-empty-new-view-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-empty-edit-dashboard-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
      expect(screen.getByTestId('global-filter-button-stub')).toBeTruthy();
    });

    it('offers no Edit button to editors in a mobile context', () => {
      const initialWidth = window.innerWidth;

      resizeTo(390);
      try {
        renderDashboard([]);

        expect(dashboard().getAttribute('data-editing')).toBe('false');
        expect(screen.getByTestId('dashboard-empty-state').textContent).toContain('Add charts, tables, lists');
        expect(screen.queryByTestId('dashboard-empty-new-view-button')).toBeNull();
        expect(screen.queryByTestId('dashboard-empty-edit-dashboard-button')).toBeNull();
        expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
        expect(screen.queryByTestId('dashboard-done-button')).toBeNull();
      } finally {
        resizeTo(initialWidth);
      }

      // Wide again: the automatic Edit mode of the empty dashboard applies.
      expect(dashboard().getAttribute('data-editing')).toBe('true');
    });
  });

  describe('a dashboard with widgets', () => {
    it('loads the workspace catalog only when a widget shows another database', () => {
      const { writeRows } = renderDashboard(makeRows(['a', 'b']));

      expect(mockUseWorkspaceDatabases).toHaveBeenLastCalledWith('workspace-id', false);

      writeRows([{ id: 'r1', height: 360, widgets: [widget('a'), { ...widget('n'), databaseId: 'notes-db' }] }]);
      expect(mockUseWorkspaceDatabases).toHaveBeenLastCalledWith('workspace-id', true);
    });

    it('opens in View mode without editing controls', () => {
      renderDashboard(makeRows(['a', 'b'], ['c']));

      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.getByTestId('dashboard-edit-button')).toBeTruthy();
      expect(screen.getAllByTestId('dashboard-row').map((row) => row.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
      expect(screen.getAllByTestId('dashboard-widget').map((item) => item.getAttribute('data-span'))).toEqual([
        '6',
        '6',
        '12',
      ]);
      // jsdom measures no width, so no row wraps.
      expect(screen.getAllByTestId('dashboard-widget').map((item) => item.getAttribute('data-line-size'))).toEqual([
        '2',
        '2',
        '1',
      ]);
      expect(screen.getAllByTestId('dashboard-widget').map((item) => item.getAttribute('data-icons'))).toEqual([
        'false',
        'false',
        'false',
      ]);
      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-height-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-row-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();
    });

    it('shows the editing controls between Edit and Done', () => {
      renderDashboard(makeRows(['a', 'b', 'c'], ['d']));

      // Edit is text only (WP03).
      expect(screen.getByTestId('dashboard-edit-button').querySelector('svg')).toBeNull();
      fireEvent.click(screen.getByTestId('dashboard-edit-button'));

      expect(dashboard().getAttribute('data-editing')).toBe('true');
      expect(
        screen
          .getAllByTestId('dashboard-width-handle')
          .map((handle) => [handle.getAttribute('data-row-id'), handle.getAttribute('data-index')])
      ).toEqual([
        ['r1', '0'],
        ['r1', '1'],
      ]);
      expect(screen.getAllByTestId('dashboard-height-handle')).toHaveLength(2);
      expect(screen.getAllByTestId('dashboard-add-widget-row-button')).toHaveLength(2);
      expect(visibleAddWidgetButton().hasAttribute('disabled')).toBe(false);
      expect(visibleAddWidgetButton().hasAttribute('aria-disabled')).toBe(false);
      // The row move controls: the first row moves down only, the last up only.
      expect(rowMoves('r1')).toEqual(['down']);
      expect(rowMoves('r2')).toEqual(['up']);

      fireEvent.click(screen.getByTestId('dashboard-done-button'));

      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-row-move-control')).toBeNull();
    });

    it('moves a row down from its row control in one write', () => {
      const { persistedRows, updateCount } = renderDashboard(makeRows(['a', 'b'], ['c']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      const before = updateCount();

      fireEvent.click(rowMoveButton('r1', 'down'));

      expect(persistedRows().map((row) => row.id)).toEqual(['r2', 'r1']);
      expect(persistedRows().map((row) => row.widgets.map((item) => [item.viewId, item.width]))).toEqual([
        [['view-c', 12]],
        [
          ['view-a', 6],
          ['view-b', 6],
        ],
      ]);
      expect(updateCount() - before).toBe(1);
      expect(mockAnnounce).toHaveBeenCalledWith('Row moved down');
      expect(picker()).toBeNull();
    });

    it('refuses row and widget-menu moves dispatched in a mobile context (an Edit-only rows write)', () => {
      const initialWidth = window.innerWidth;
      const { persistedRows } = renderDashboard(makeRows(['a', 'b'], ['c']), { extra: <MoveProbe /> });

      // Both moves write `rows`, an Edit-only key.
      expect(DASHBOARD_EDIT_ONLY_UPDATE_KEYS).toContain('rows');
      expect(touchesEditOnlyKeys({ rows: persistedRows() })).toBe(true);

      resizeTo(390);
      try {
        fireEvent.click(screen.getByTestId('probe-move-row'));
        fireEvent.click(screen.getByTestId('probe-move-left'));
        expect(persistedRows().map((row) => row.widgets.map((item) => item.viewId))).toEqual([
          ['view-a', 'view-b'],
          ['view-c'],
        ]);
      } finally {
        resizeTo(initialWidth);
      }

      // Wide again, the same dispatches write.
      fireEvent.click(screen.getByTestId('probe-move-row'));
      fireEvent.click(screen.getByTestId('probe-move-left'));
      expect(persistedRows().map((row) => row.widgets.map((item) => item.viewId))).toEqual([
        ['view-c'],
        ['view-b', 'view-a'],
      ]);
    });

    it('disables every add control with the full tooltip on a full dashboard', async () => {
      renderDashboard(makeRows(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k'], ['l']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));

      // Full rows have no "+"; the others are refused, like "Add to new row".
      expect(screen.getAllByTestId('dashboard-add-widget-row-button').map((button) => button.dataset.rowId)).toEqual([
        'r3',
        'r4',
      ]);
      for (const button of [...screen.getAllByTestId('dashboard-add-widget-row-button'), visibleAddWidgetButton()]) {
        expect(button.getAttribute('aria-disabled')).toBe('true');
      }

      act(() => visibleAddWidgetButton().focus());
      const tooltip = await screen.findByTestId('dashboard-full-tooltip');

      expect(tooltip.textContent).toContain('Dashboard is full');
      expect(tooltip.textContent).toContain('Delete a view to add a new one');
      expectNoLimitBanner();
    });

    it('adds a widget into a row from its "+" and splits the row evenly', async () => {
      const rendered = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      serveDefaultView(rendered);
      fireEvent.click(rowAddButton('r1'));
      await settle();

      expect(rendered.persistedRows()[0].widgets.map((item) => [item.viewId, item.width])).toEqual([
        ['view-a', 6],
        ['default-view', 6],
      ]);
      fireEvent.click(screen.getByTestId('pick-tasks'));
      expect(rendered.persistedRows()[0].widgets.map((item) => [item.viewId, item.width])).toEqual([
        ['view-a', 6],
        ['tasks-view', 6],
      ]);
    });

    it('adds a new row from the add button under the last row', async () => {
      const rendered = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      serveDefaultView(rendered);
      fireEvent.click(visibleAddWidgetButton());
      await settle();

      expect(rendered.persistedRows().map((row) => row.widgets.map((item) => [item.viewId, item.databaseId]))).toEqual([
        [['view-a', DATABASE_ID]],
        [['default-view', DATABASE_ID]],
      ]);
    });

    it('still inserts the widget when the picker was closed during the creation', async () => {
      const rendered = renderDashboard(makeRows(['a']));
      const creation = serveDefaultView(rendered, { hold: true });

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(rowAddButton('r1'));
      await settle();
      fireEvent.click(screen.getByTestId('close-picker'));
      expect(picker()).toBeNull();

      await act(async () => creation.release());
      await settle();

      expect(rendered.persistedRows()[0].widgets.map((item) => item.viewId)).toEqual(['view-a', 'default-view']);
      expect(picker()).toBeNull();
    });

    it('deletes the created view when the dashboard filled up during the creation', async () => {
      const rendered = renderDashboard(makeRows(['a']));
      const creation = serveDefaultView(rendered, { hold: true });

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(visibleAddWidgetButton());
      await settle();
      rendered.writeRows(makeRows(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l']));
      await act(async () => creation.release());
      await settle();

      expect(mockDeleteView).toHaveBeenCalledWith(expect.anything(), {
        viewId: 'default-view',
        databaseId: DATABASE_ID,
      });
      expect(picker()).toBeNull();
      // Refused once, at the insert: the click itself was allowed.
      expect(mockAnnounce.mock.calls).toEqual([['Dashboard is full. Delete a view to add a new one.']]);
      expectNoLimitBanner();
      expect(rendered.persistedRows().flatMap((row) => row.widgets)).toHaveLength(12);
      expect(rendered.persistedRows().flatMap((row) => row.widgets.map((item) => item.viewId))).not.toContain(
        'default-view'
      );
      expect(screen.queryByTestId('dashboard-widget-pending')).toBeNull();
    });

    it('closes the picker when leaving Edit mode, keeping the widget', async () => {
      const rendered = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      serveDefaultView(rendered);
      fireEvent.click(visibleAddWidgetButton());
      await settle();
      expect(picker()).toBeTruthy();

      fireEvent.click(screen.getByTestId('dashboard-done-button'));
      expect(picker()).toBeNull();
      expect(rendered.persistedRows().flatMap((row) => row.widgets.map((item) => item.viewId))).toEqual([
        'view-a',
        'default-view',
      ]);

      // Closed for good: entering Edit mode again does not bring it back.
      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      expect(picker()).toBeNull();
    });

    it('closes the picker when the window narrows to a mobile context', async () => {
      const initialWidth = window.innerWidth;
      const rendered = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      serveDefaultView(rendered);
      fireEvent.click(visibleAddWidgetButton());
      await settle();
      expect(picker()).toBeTruthy();

      resizeTo(390);
      try {
        expect(dashboard().getAttribute('data-editing')).toBe('false');
        expect(picker()).toBeNull();
      } finally {
        resizeTo(initialWidth);
      }

      // Edit mode comes back with the wide window; the closed picker does not.
      expect(dashboard().getAttribute('data-editing')).toBe('true');
      expect(picker()).toBeNull();
    });

    it('keeps Edit mode while write access is re-checked', () => {
      const { setReadOnly } = renderDashboard(makeRows(['a', 'b']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      expect(dashboard().getAttribute('data-editing')).toBe('true');

      // Nothing is editable while access is unknown.
      setReadOnly(true);
      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.queryByTestId('dashboard-done-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();

      setReadOnly(false);
      expect(dashboard().getAttribute('data-editing')).toBe('true');
      expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
      expect(screen.getAllByTestId('dashboard-width-handle')).toHaveLength(1);
      expect(visibleAddWidgetButton().hasAttribute('disabled')).toBe(false);
    });

    it('closes the picker when write access is lost and does not bring it back with Edit mode', async () => {
      const rendered = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      serveDefaultView(rendered);
      fireEvent.click(rowAddButton('r1'));
      await settle();
      expect(picker()).toBeTruthy();

      rendered.setReadOnly(true);
      expect(picker()).toBeNull();

      rendered.setReadOnly(false);
      expect(picker()).toBeNull();
      // The widget stays.
      expect(rendered.persistedRows()[0].widgets.map((item) => item.viewId)).toEqual(['view-a', 'default-view']);
    });

    it('keeps an in-flight creation going while write access is re-checked, without its picker', async () => {
      const rendered = renderDashboard(makeRows(['a']));
      const creation = serveDefaultView(rendered, { hold: true });

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(rowAddButton('r1'));
      await settle();
      expect(picker()?.getAttribute('data-state')).toBe('creating');

      rendered.setReadOnly(true);
      expect(picker()).toBeNull();
      rendered.setReadOnly(false);

      await act(async () => creation.release());
      await settle();

      expect(picker()).toBeNull();
      expect(rendered.persistedRows()[0].widgets.map((item) => item.viewId)).toEqual(['view-a', 'default-view']);
    });

    it('hides the add button of a full row', () => {
      renderDashboard(makeRows(['a', 'b', 'c', 'd'], ['e']));
      fireEvent.click(screen.getByTestId('dashboard-edit-button'));

      expect(rowAddButton('r1')).toBeUndefined();
      expect(rowAddButton('r2').hasAttribute('aria-disabled')).toBe(false);
      expectNoLimitBanner();
      // Nothing was refused: the full row offers nothing to press.
      expect(mockAnnounce).not.toHaveBeenCalled();
    });

    it('refuses adds on a full dashboard without banners, creating no view', async () => {
      const { persistedRows } = renderDashboard(
        makeRows(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l'])
      );

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));

      const addButton = visibleAddWidgetButton();

      expect(addButton.getAttribute('aria-disabled')).toBe('true');
      // Every row is full: no row offers "+".
      expect(screen.queryByTestId('dashboard-add-widget-row-button')).toBeNull();

      fireEvent.click(addButton);
      await settle();

      expect(mockAnnounce.mock.calls).toEqual([['Dashboard is full. Delete a view to add a new one.']]);
      expect(mockCreateView).not.toHaveBeenCalled();
      expect(picker()).toBeNull();
      expectNoLimitBanner();
      expect(persistedRows().flatMap((row) => row.widgets)).toHaveLength(12);
    });

    it('shows the first 12 widgets of a layout saved over the limit, refuses adds, and keeps the rest on the next write', async () => {
      const rendered = renderDashboard([], { extra: <MoveProbe /> });
      const ids = 'abcdefghijklmn'.split('');
      const stored = (row: string[], index: number) => ({
        id: `r${index + 1}`,
        height: 360,
        widgets: row.map((id) => ({ id, view_id: `view-${id}`, database_id: DATABASE_ID, width: 12 / row.length })),
      });

      // Another client saved 14 widgets in rows of 4, 4, 4 and 2.
      rendered.writeRawRows([ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12), ids.slice(12)].map(stored));

      expect(screen.getAllByTestId('dashboard-widget').map((element) => element.dataset.widgetId)).toEqual(
        ids.slice(0, 12)
      );
      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      expect(visibleAddWidgetButton().getAttribute('aria-disabled')).toBe('true');
      expect(screen.queryByTestId('dashboard-add-widget-row-button')).toBeNull();
      fireEvent.click(visibleAddWidgetButton());
      await settle();
      expect(mockAnnounce.mock.calls).toEqual([['Dashboard is full. Delete a view to add a new one.']]);
      expect(mockCreateView).not.toHaveBeenCalled();

      // A row move rewrites the rows: the two hidden widgets stay stored after the shown ones.
      fireEvent.click(screen.getByTestId('probe-move-row'));
      expect(rendered.persistedRows().map((row) => row.id)).toEqual(['r2', 'r1', 'r3']);
      expect(rendered.storedWidgetIds()).toEqual([
        ...ids.slice(4, 8),
        ...ids.slice(0, 4),
        ...ids.slice(8, 12),
        'm',
        'n',
      ]);
      expect(screen.getAllByTestId('dashboard-widget')).toHaveLength(12);
      expectNoLimitBanner();
    });

    it('never offers editing to read-only viewers', () => {
      renderDashboard(makeRows(['a', 'b']), { readOnly: true });

      expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
    });
  });

  describe('the selected widget', () => {
    const added = () =>
      screen
        .getAllByTestId('dashboard-widget')
        .find((element) => element.dataset.viewId === 'tasks-view') as HTMLElement;
    const isSelected = () => added().getAttribute('data-selected');

    /** A new widget starts selected, and stays selected after its view is picked. */
    async function addWidget() {
      const rendered = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      serveDefaultView(rendered);
      fireEvent.click(visibleAddWidgetButton());
      await settle();
      fireEvent.click(screen.getByTestId('pick-tasks'));
      expect(isSelected()).toBe('true');
    }

    /** What Radix portals for a menu or a popover, or (with `role='tooltip'` inside) for a tooltip. */
    function openPopper(role?: 'tooltip') {
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-radix-popper-content-wrapper', '');
      wrapper.innerHTML = role ? `<div><span role="${role}">Add widget</span></div>` : '<div role="menu"></div>';
      document.body.appendChild(wrapper);
      return wrapper;
    }

    afterEach(() => {
      document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach((wrapper) => wrapper.remove());
    });

    it('is kept by a press on it and cleared by a press outside it', async () => {
      await addWidget();

      fireEvent.pointerDown(added());
      expect(isSelected()).toBe('true');
      fireEvent.pointerDown(screen.getByTestId('global-filter-bar-stub'));
      expect(isSelected()).toBe('false');
    });

    it('is cleared by Escape', async () => {
      await addWidget();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(isSelected()).toBe('false');
    });

    it('is kept while a menu or a popover is open: the press or the Escape belongs to that layer', async () => {
      await addWidget();
      const menu = openPopper();

      fireEvent.pointerDown(screen.getByTestId('global-filter-bar-stub'));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(isSelected()).toBe('true');

      menu.remove();
      fireEvent.pointerDown(screen.getByTestId('global-filter-bar-stub'));
      expect(isSelected()).toBe('false');
    });

    it('is not shielded by an open tooltip', async () => {
      await addWidget();
      // The tooltip of a control that just took the focus back (the picker closed).
      openPopper('tooltip');

      fireEvent.pointerDown(screen.getByTestId('global-filter-bar-stub'));
      expect(isSelected()).toBe('false');
    });

    it('ends with Edit mode', async () => {
      await addWidget();

      fireEvent.click(screen.getByTestId('dashboard-done-button'));
      expect(isSelected()).toBe('false');
    });
  });
});
