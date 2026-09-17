import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { DASHBOARD_LIMIT_MESSAGE_DURATION } from '../constants';
import { Dashboard } from '../Dashboard';
import { DashboardActions } from '../DashboardActions';
import { DashboardProvider } from '../DashboardContext';
import { WidgetPickerRequest } from '../DashboardUiContext';
import { CreateWidgetViewRequest } from '../hooks/useCreateWidgetView';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? key).replace('{{count}}', String(options?.count ?? '')),
  }),
}));

// The indicator package ships compiled CSS that jest cannot parse.
jest.mock('@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box', () => ({
  DropIndicator: ({ edge }: { edge: string }) => <div data-edge={edge} data-testid='drop-indicator' />,
}));

// jsdom computes no Tailwind overflow, so auto-scroll would warn on every mount.
jest.mock('@atlaskit/pragmatic-drag-and-drop-auto-scroll/element', () => ({
  autoScrollForElements: () => () => undefined,
}));

jest.mock('../global-filters', () => ({
  GlobalFilterBar: () => <div data-testid='global-filter-bar-stub' />,
  GlobalFilterButton: () => <button data-testid='global-filter-button-stub' type='button' />,
}));

jest.mock('../DashboardWidget', () => ({
  DashboardWidget: ({
    widget,
    span,
    height,
  }: {
    widget: { id: string; viewId: string; databaseId: string };
    span: number;
    height: number;
  }) => (
    <div
      data-database-id={widget.databaseId}
      data-height={height}
      data-span={span}
      data-testid='dashboard-widget'
      data-view-id={widget.viewId}
      data-widget-id={widget.id}
    />
  ),
}));

jest.mock('../WidgetPicker', () => ({
  WidgetPicker: ({
    request,
    onPick,
    onClose,
    createView,
  }: {
    request: WidgetPickerRequest | null;
    onPick: (viewId: string, databaseId: string) => void;
    onClose: () => void;
    createView: (request: CreateWidgetViewRequest) => Promise<string | null>;
  }) =>
    request ? (
      <div
        data-mode={request.mode}
        data-placement={request.mode === 'add' ? JSON.stringify(request.placement) : undefined}
        data-testid='dashboard-widget-picker'
      >
        <button data-testid='pick-tasks' onClick={() => onPick('tasks-view', 'tasks-db')} type='button' />
        <button
          data-testid='create-board'
          onClick={() =>
            void createView({
              databaseId: 'notes-db',
              primaryViewId: 'notes-grid',
              isHost: false,
              layout: DatabaseViewLayout.Board,
            })
          }
          type='button'
        />
        <button data-testid='close-picker' onClick={onClose} type='button' />
      </div>
    ) : null,
}));

jest.mock('../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: [], loading: false, error: null }),
}));

const mockCreateView = jest.fn<Promise<string>, [CreateWidgetViewRequest]>();

jest.mock('../hooks/useCreateWidgetView', () => ({
  useCreateWidgetView: () => ({ createView: mockCreateView, canCreateInOtherDatabases: true, bridge: null }),
}));

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
  return { doc, database, view };
}

function renderDashboard(rows: DashboardRow[], { readOnly = false } = {}) {
  const { doc, database, view } = createDatabaseDoc(rows);
  const value: DatabaseContextState = {
    readOnly,
    databaseDoc: doc,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  render(
    <DatabaseContext.Provider value={value}>
      <DashboardProvider>
        <DashboardActions />
        <Dashboard />
      </DashboardProvider>
    </DatabaseContext.Provider>
  );

  return {
    persistedRows: () => readDashboardLayoutSetting(database, VIEW_ID).rows,
    writeRows: (next: DashboardRow[]) =>
      act(() => {
        doc.transact(() => updateDashboardLayoutSetting(view, { rows: next }));
      }),
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

function visibleAddWidgetButton() {
  return screen.getByTestId('dashboard-add-widget-button');
}

describe('Dashboard', () => {
  beforeEach(() => {
    mockCreateView.mockReset();
  });

  describe('an empty dashboard', () => {
    it('opens in Edit mode for editors with the builder prompt', () => {
      renderDashboard([]);

      expect(dashboard().getAttribute('data-editing')).toBe('true');
      expect(screen.getByTestId('dashboard-done-button')).toBeTruthy();
      const empty = screen.getByTestId('dashboard-empty-state');

      expect(empty.textContent).toContain('Build your dashboard');
      expect(within(empty).getByTestId('dashboard-add-widget-button').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId('global-filter-bar-stub')).toBeTruthy();
    });

    it('adds the picked view as the first row', () => {
      const { persistedRows } = renderDashboard([]);

      fireEvent.click(visibleAddWidgetButton());
      const picker = screen.getByTestId('dashboard-widget-picker');

      expect(picker.getAttribute('data-mode')).toBe('add');
      expect(JSON.parse(picker.getAttribute('data-placement') ?? '{}')).toEqual({ type: 'new_row' });

      fireEvent.click(screen.getByTestId('pick-tasks'));

      expect(screen.queryByTestId('dashboard-widget-picker')).toBeNull();
      expect(persistedRows()).toHaveLength(1);
      expect(persistedRows()[0].widgets).toEqual([
        { id: expect.stringMatching(/^w:/), viewId: 'tasks-view', databaseId: 'tasks-db', width: 12 },
      ]);
      expect(screen.queryByTestId('dashboard-empty-state')).toBeNull();
      expect(screen.getByTestId('dashboard-widget').getAttribute('data-view-id')).toBe('tasks-view');
    });

    it('tells viewers it has no widgets after Done, and offers Edit again', () => {
      renderDashboard([]);

      fireEvent.click(screen.getByTestId('dashboard-done-button'));

      expect(dashboard().getAttribute('data-editing')).toBe('false');
      const empty = screen.getByTestId('dashboard-empty-state');

      expect(empty.textContent).toContain('This dashboard has no widgets yet.');
      expect(within(empty).queryByTestId('dashboard-add-widget-button')).toBeNull();

      fireEvent.click(within(empty).getByTestId('dashboard-empty-edit-button'));
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

    it('stays in Edit mode once the editor has started building', () => {
      const { writeRows } = renderDashboard([]);

      fireEvent.click(visibleAddWidgetButton());
      fireEvent.click(screen.getByTestId('close-picker'));
      writeRows(makeRows(['a']));

      expect(dashboard().getAttribute('data-editing')).toBe('true');
    });

    it('does not force View mode after the editor re-entered Edit mode themselves', () => {
      const { writeRows } = renderDashboard([]);

      fireEvent.click(screen.getByTestId('dashboard-done-button'));
      fireEvent.click(screen.getByTestId('dashboard-empty-edit-button'));
      writeRows(makeRows(['a']));

      expect(dashboard().getAttribute('data-editing')).toBe('true');
    });

    it('stays in View mode for read-only viewers', () => {
      renderDashboard([], { readOnly: true });

      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.getByTestId('dashboard-empty-state').textContent).toContain('This dashboard has no widgets yet.');
      expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-empty-edit-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
      expect(screen.getByTestId('global-filter-button-stub')).toBeTruthy();
    });
  });

  describe('a dashboard with widgets', () => {
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
      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-height-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-row-button')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();
    });

    it('shows the editing controls between Edit and Done', () => {
      renderDashboard(makeRows(['a', 'b', 'c'], ['d']));

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

      fireEvent.click(screen.getByTestId('dashboard-done-button'));

      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
      expect(screen.queryByTestId('dashboard-add-widget-button')).toBeNull();
    });

    it('adds a widget into a row and splits the row evenly', () => {
      const { persistedRows } = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(rowAddButton('r1'));

      expect(JSON.parse(screen.getByTestId('dashboard-widget-picker').getAttribute('data-placement') ?? '{}')).toEqual({
        type: 'existing_row',
        rowId: 'r1',
        index: 1,
      });

      fireEvent.click(screen.getByTestId('pick-tasks'));

      expect(persistedRows()[0].widgets.map((item) => [item.viewId, item.width])).toEqual([
        ['view-a', 6],
        ['tasks-view', 6],
      ]);
    });

    it('adds a newly created view as a widget once it exists', async () => {
      const creation = deferred<string>();

      mockCreateView.mockReturnValueOnce(creation.promise);
      const { persistedRows } = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(visibleAddWidgetButton());
      fireEvent.click(screen.getByTestId('create-board'));

      expect(mockCreateView).toHaveBeenCalledWith(
        expect.objectContaining({ databaseId: 'notes-db', layout: DatabaseViewLayout.Board })
      );
      // Still open while the view is being created.
      expect(screen.getByTestId('dashboard-widget-picker')).toBeTruthy();

      await act(async () => {
        creation.resolve('notes-board');
        await creation.promise;
      });

      expect(screen.queryByTestId('dashboard-widget-picker')).toBeNull();
      expect(persistedRows().map((row) => row.widgets.map((item) => [item.viewId, item.databaseId]))).toEqual([
        [['view-a', DATABASE_ID]],
        [['notes-board', 'notes-db']],
      ]);
    });

    it('still adds the created view when the picker was closed meanwhile', async () => {
      const creation = deferred<string>();

      mockCreateView.mockReturnValueOnce(creation.promise);
      const { persistedRows } = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(rowAddButton('r1'));
      fireEvent.click(screen.getByTestId('create-board'));
      fireEvent.click(screen.getByTestId('close-picker'));

      await act(async () => {
        creation.resolve('notes-board');
        await creation.promise;
      });

      expect(persistedRows()[0].widgets.map((item) => item.viewId)).toEqual(['view-a', 'notes-board']);
    });

    it('creates nothing when the dashboard filled up while the picker was open', async () => {
      const { persistedRows, writeRows } = renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(visibleAddWidgetButton());
      writeRows(makeRows(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l']));

      await act(async () => {
        fireEvent.click(screen.getByTestId('create-board'));
      });

      expect(mockCreateView).not.toHaveBeenCalled();
      expect(screen.queryByTestId('dashboard-widget-picker')).toBeNull();
      expect(
        screen
          .getAllByTestId('dashboard-limit-message')
          .some((message) => message.getAttribute('data-variant') === 'banner')
      ).toBe(true);
      expect(persistedRows().flatMap((row) => row.widgets)).toHaveLength(12);
    });

    it('closes the picker when leaving Edit mode', () => {
      renderDashboard(makeRows(['a']));

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));
      fireEvent.click(visibleAddWidgetButton());
      expect(screen.getByTestId('dashboard-widget-picker')).toBeTruthy();

      fireEvent.click(screen.getByTestId('dashboard-done-button'));
      expect(screen.queryByTestId('dashboard-widget-picker')).toBeNull();
    });

    it('explains a full row instead of opening the picker', () => {
      jest.useFakeTimers();

      try {
        renderDashboard(makeRows(['a', 'b', 'c', 'd'], ['e']));
        fireEvent.click(screen.getByTestId('dashboard-edit-button'));

        const fullRowButton = rowAddButton('r1');

        expect(fullRowButton.hasAttribute('disabled')).toBe(true);
        expect(rowAddButton('r2').hasAttribute('disabled')).toBe(false);

        fireEvent.click(fullRowButton.parentElement as HTMLElement);

        const message = screen.getByTestId('dashboard-limit-message');

        expect(message.getAttribute('data-reason')).toBe('row');
        expect(message.textContent).toContain('A row holds up to 4 widgets.');
        expect(screen.queryByTestId('dashboard-widget-picker')).toBeNull();

        act(() => {
          jest.advanceTimersByTime(DASHBOARD_LIMIT_MESSAGE_DURATION);
        });
        expect(screen.queryByTestId('dashboard-limit-message')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps the widget limit visible on a full dashboard', () => {
      const { persistedRows } = renderDashboard(
        makeRows(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i', 'j', 'k', 'l'])
      );

      fireEvent.click(screen.getByTestId('dashboard-edit-button'));

      const addButton = visibleAddWidgetButton();

      expect(addButton.hasAttribute('disabled')).toBe(true);
      expect(
        screen.getAllByTestId('dashboard-add-widget-row-button').every((button) => button.hasAttribute('disabled'))
      ).toBe(true);
      const inline = screen.getByTestId('dashboard-limit-message');

      expect(inline.getAttribute('data-reason')).toBe('dashboard');
      expect(inline.textContent).toContain('Dashboards support up to 12 widgets.');

      fireEvent.click(addButton.parentElement as HTMLElement);

      const messages = screen.getAllByTestId('dashboard-limit-message');

      expect(messages.map((message) => message.getAttribute('data-variant')).sort()).toEqual(['banner', 'inline']);
      expect(screen.queryByTestId('dashboard-widget-picker')).toBeNull();
      expect(persistedRows().flatMap((row) => row.widgets)).toHaveLength(12);
    });

    it('never offers editing to read-only viewers', () => {
      renderDashboard(makeRows(['a', 'b']), { readOnly: true });

      expect(screen.queryByTestId('dashboard-edit-button')).toBeNull();
      expect(dashboard().getAttribute('data-editing')).toBe('false');
      expect(screen.queryByTestId('dashboard-width-handle')).toBeNull();
    });
  });
});
