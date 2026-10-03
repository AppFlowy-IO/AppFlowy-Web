/**
 * Shared fixtures of the dashboard component tests: typed database docs,
 * dashboard rows, the dashboard and widget context values, and the provider
 * tree a widget box needs.
 *
 * Keep `jest.mock` calls in each test file (they are hoisted per file). This
 * module imports no component that needs a mock (the widget box, the nested
 * database), so any dashboard test can use it.
 */
import { act } from '@testing-library/react';
import { createRef, ReactNode, useCallback, useState } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow, DashboardWidget as DashboardWidgetData } from '@/application/database-yjs/dashboard.type';
import {
  DatabaseViewLayout,
  ViewLayout,
  YDatabase,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { DashboardContextValue, DashboardFiltersContextValue, DashboardProvider } from '../DashboardContext';
import {
  DashboardHostContext,
  DashboardSelectionContext,
  DashboardUiContext,
  DashboardUiContextValue,
} from '../DashboardUiContext';
import { WidgetActions, WidgetContextValue } from '../WidgetContext';

import type { DashboardWidget } from '../DashboardWidget';
import type { RowHeightPreview } from '../hooks/useRowHeightResize';
import type { ComponentProps } from 'react';

/* ----------------------------------------------------------------------------
 * Database docs
 * ------------------------------------------------------------------------- */

export interface DatabaseDocViewSpec {
  id: string;
  name?: string;
  layout?: DatabaseViewLayout;
  /** `created_at`, which orders the tabs of a standalone database. */
  createdAt?: string;
  /** Dashboard rows persisted on the view (makes it a dashboard's view). */
  rows?: DashboardRow[];
}

export interface DatabaseDocFixture {
  doc: YDoc;
  database: YDatabase;
  views: YDatabaseViews;
  /** A view of the doc; throws for an unknown id. */
  view: (viewId: string) => YDatabaseView;
}

/**
 * A database collab with the given views and no field, built the way the app
 * stores it (`data_section.database`). The Y.js casts of the test docs live here.
 */
export function createDatabaseDoc({
  id,
  guid = id,
  views,
}: {
  id: string;
  /** The doc's guid (the database id by default). */
  guid?: string;
  views: DatabaseDocViewSpec[];
}): DatabaseDocFixture {
  const doc = new Y.Doc({ guid }) as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const viewMap = new Y.Map<YDatabaseView>() as YDatabaseViews;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, id);
  database.set(YjsDatabaseKey.fields, new Y.Map() as never);
  database.set(YjsDatabaseKey.views, viewMap as never);
  doc.transact(() => {
    views.forEach((spec) => {
      const view = new Y.Map() as YDatabaseView;

      viewMap.set(spec.id, view);
      if (spec.name !== undefined) view.set(YjsDatabaseKey.name, spec.name);
      if (spec.layout !== undefined) view.set(YjsDatabaseKey.layout, spec.layout);
      if (spec.createdAt !== undefined) view.set(YjsDatabaseKey.created_at, spec.createdAt);
      if (spec.rows) updateDashboardLayoutSetting(view, { rows: spec.rows });
    });
  });

  return {
    doc,
    database,
    views: viewMap,
    view: (viewId) => {
      const view = viewMap.get(viewId);

      if (!view) throw new Error(`no view ${viewId} in the test database ${id}`);
      return view;
    },
  };
}

/* ----------------------------------------------------------------------------
 * Rows and async helpers
 * ------------------------------------------------------------------------- */

/** Rows from widget-id lists of one database: 360px tall, the 12 columns split evenly. */
export function makeRowsFor(databaseId: string) {
  return (...layout: string[][]): DashboardRow[] =>
    layout.map((ids, index) => ({
      id: `r${index + 1}`,
      height: 360,
      widgets: ids.map((id) => ({ id, viewId: `view-${id}`, databaseId, width: 12 / ids.length })),
    }));
}

/** `makeRowsFor('db')`. */
export const makeRows = makeRowsFor('db');

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/** A promise settled by the test. */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, resolve, reject };
}

/** Resize the jsdom window (the dashboard's mobile context follows its width). */
export function resizeTo(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });
}

/* ----------------------------------------------------------------------------
 * Context values
 * ------------------------------------------------------------------------- */

export function createDashboardContextValue(overrides: Partial<DashboardContextValue> = {}): DashboardContextValue {
  return {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db',
    canEdit: true,
    isEditing: false,
    setEditing: jest.fn(),
    mobileContext: false,
    canEnterEdit: true,
    pinEditing: jest.fn(),
    updateSetting: jest.fn(),
    updateRows: jest.fn(),
    ...overrides,
  };
}

export function createDashboardFiltersValue(
  overrides: Partial<DashboardFiltersContextValue> = {}
): DashboardFiltersContextValue {
  return {
    globalFilters: [],
    effectiveGlobalFilters: [],
    localGlobalFilters: null,
    setLocalGlobalFilters: jest.fn(),
    getViewOverlay: jest.fn(),
    setViewOverlayWritable: jest.fn(),
    resetViewOverlays: jest.fn(),
    commitViewOverlays: jest.fn(),
    ...overrides,
  };
}

export function createDashboardUiValue(overrides: Partial<DashboardUiContextValue> = {}): DashboardUiContextValue {
  return {
    hostDatabaseId: 'db',
    dndInstanceId: Symbol('dashboard-test'),
    getRows: () => [],
    updateRows: jest.fn(),
    openPicker: jest.fn(),
    showLimitMessage: jest.fn(),
    acquireSourceDoc: () => () => undefined,
    selectWidget: jest.fn(),
    ...overrides,
  };
}

export function createWidgetActions(): WidgetActions {
  return {
    open: jest.fn(),
    changeView: jest.fn(),
    duplicate: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
    openSettings: jest.fn(),
  };
}

/** A grid widget `w1` of `db` in View mode, with titles; `editing` also sets `isEditing`. */
export function createWidgetContextValue(overrides: Partial<WidgetContextValue> = {}): WidgetContextValue {
  const editing = overrides.editing ?? false;

  return {
    widgetId: 'w1',
    databaseId: 'db',
    viewId: 'view-w1',
    name: 'Tasks Grid',
    icon: null,
    layout: ViewLayout.Grid,
    isEditing: editing,
    canEdit: true,
    editing,
    showWidgetTitles: true,
    showIcon: false,
    headerHeight: 40,
    isDragging: false,
    setDragHandle: jest.fn(),
    menuOpen: false,
    setMenuOpen: jest.fn(),
    settingsOpen: false,
    setSettingsOpen: jest.fn(),
    getBoxElement: () => null,
    titleRef: createRef<HTMLButtonElement>(),
    optionsRef: createRef<HTMLButtonElement>(),
    settingsToolRef: createRef<HTMLButtonElement>(),
    actions: createWidgetActions(),
    ...overrides,
  };
}

/* ----------------------------------------------------------------------------
 * A widget box on a dashboard
 * ------------------------------------------------------------------------- */

/** Widget `w1`: view `v1` of the host database `db`, the whole row. */
export const TEST_WIDGET: DashboardWidgetData = { id: 'w1', viewId: 'v1', databaseId: 'db', width: 12 };

/** No row height drag in progress. */
export const NO_PREVIEW: RowHeightPreview = { subscribe: () => () => undefined, get: () => null };

/**
 * The host database `db` of a dashboard (view `dashboard`) holding
 * `TEST_WIDGET` in a 360px row; the widget's view `v1` is `layout`.
 */
export function createWidgetHost({
  layout = DatabaseViewLayout.Grid,
  name = 'Tasks',
  readOnly = false,
}: { layout?: DatabaseViewLayout; name?: string; readOnly?: boolean } = {}): DatabaseContextState {
  const { doc } = createDatabaseDoc({
    id: 'db',
    views: [
      { id: 'dashboard', rows: [{ id: 'r1', height: 360, widgets: [TEST_WIDGET] }] },
      { id: 'v1', name, layout },
    ],
  });

  return {
    databaseDoc: doc,
    readOnly,
    canWrite: !readOnly,
    rowMap: {},
    databasePageId: 'dashboard',
    activeViewId: 'dashboard',
    workspaceId: 'workspace-id',
  };
}

/**
 * What `Dashboard` gives a widget box: the host database and its services,
 * the dashboard state, the UI context and the selection. The selection is
 * real, as the dashboard keeps it: only Edit mode selects, and a clear with
 * `onlyIf` only clears that widget.
 */
export function DashboardWidgetProviders({
  host,
  editing = false,
  ui,
  children,
}: {
  host: DatabaseContextState;
  editing?: boolean;
  /** Overrides of the UI context (its `selectWidget` is the real selection). */
  ui?: Partial<DashboardUiContextValue>;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectWidget = useCallback(
    (id: string | null, options?: { onlyIf?: string }) => {
      if (id === null) {
        setSelected((current) => (options?.onlyIf === undefined || current === options.onlyIf ? null : current));
      } else if (editing) {
        setSelected(id);
      }
    },
    [editing]
  );
  const [uiValue] = useState(() => createDashboardUiValue({ selectWidget, ...ui }));

  return (
    <DatabaseContext.Provider value={host}>
      <DashboardHostContext.Provider value={host}>
        <DashboardProvider>
          <DashboardUiContext.Provider value={{ ...uiValue, selectWidget: ui?.selectWidget ?? selectWidget }}>
            <DashboardSelectionContext.Provider value={editing ? selected : null}>
              {children}
            </DashboardSelectionContext.Provider>
          </DashboardUiContext.Provider>
        </DashboardProvider>
      </DashboardHostContext.Provider>
    </DatabaseContext.Provider>
  );
}

/** The props of a `TEST_WIDGET` box spanning its 360px row, in View mode with titles. */
export function widgetBoxProps(
  overrides: Partial<ComponentProps<typeof DashboardWidget>> = {}
): ComponentProps<typeof DashboardWidget> {
  return {
    canEdit: true,
    height: 360,
    heightPreview: NO_PREVIEW,
    isDragging: false,
    isEditing: false,
    lineSize: 1,
    showIconsInHeading: false,
    showWidgetTitles: true,
    span: 12,
    widget: TEST_WIDGET,
    ...overrides,
  };
}
