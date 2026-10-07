import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

import { DashboardProvider, useDashboardFilters, useDashboardPrivateSummary } from '../../DashboardContext';

let mockPersistThrows = false;

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));
jest.mock('sonner', () => ({ toast: { custom: jest.fn(), dismiss: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));
// The layout write refused before anything is applied (a missing doc, a transaction that throws).
jest.mock('@/application/database-yjs', () => {
  const actual = jest.requireActual('@/application/database-yjs');

  return {
    ...actual,
    useUpdateDashboardSetting: () => {
      const persist = actual.useUpdateDashboardSetting();

      return (update: unknown) => {
        if (mockPersistThrows) throw new Error('boom');
        persist(update);
      };
    },
  };
});

const mockToast = (jest.requireMock('sonner') as { toast: { custom: jest.Mock; error: jest.Mock } }).toast;

const DASHBOARD_VIEW_ID = 'dashboard-view';
const WIDGET = { id: 'widget', databaseId: 'source-1', viewId: 'widget-view' };
const ROWS: DashboardRow[] = [{ id: 'row', height: 360, widgets: [{ ...WIDGET, width: 12 }] }];
const GLOBAL_FILTER: DashboardGlobalFilter = {
  id: 'global-filter',
  name: 'Name',
  fieldType: FieldType.RichText,
  condition: 0,
  content: 'saved',
  targets: { 'source-1': 'name' },
};
const PRIVATE_VALUE = { condition: 0, content: 'private' };

function createDatabase(databaseId: string, viewId: string) {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, views);
  views.set(viewId, view);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  return { doc, database, view };
}

function context(doc: YDoc, viewId: string): DatabaseContextState {
  return {
    databaseDoc: doc,
    databasePageId: viewId,
    activeViewId: viewId,
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace',
  };
}

function renderDashboard(host: ReturnType<typeof createDatabase>) {
  return renderHook(() => ({ filters: useDashboardFilters(), changes: useDashboardPrivateSummary() }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={context(host.doc, DASHBOARD_VIEW_ID)}>
        <DatabaseHistoryScope>
          <DashboardProvider>{children}</DashboardProvider>
        </DatabaseHistoryScope>
      </DatabaseContext.Provider>
    ),
  });
}

function savedContent(host: ReturnType<typeof createDatabase>) {
  return readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID).globalFilters[0].content;
}

beforeEach(() => {
  mockPersistThrows = false;
  mockToast.custom.mockClear();
  mockToast.error.mockClear();
});

describe('Save for everyone when a write throws', () => {
  it('keeps the private global values, says so and saves nothing when the global filter write throws', () => {
    const host = createDatabase('host', DASHBOARD_VIEW_ID);

    updateDashboardLayoutSetting(host.view, { rows: ROWS, globalFilters: [GLOBAL_FILTER] });
    const { result, unmount } = renderDashboard(host);

    act(() => result.current.filters.setPrivateGlobalValue(GLOBAL_FILTER.id, PRIVATE_VALUE));
    expect(result.current.changes).toMatchObject({ hasChanges: true, dirtyGlobalCount: 1 });

    mockPersistThrows = true;
    let group: object | null = {};

    act(() => {
      group = result.current.filters.saveForEveryone();
    });

    // Nothing was saved: the unsaved value stays, for a retry.
    expect(group).toBeNull();
    expect(savedContent(host)).toBe('saved');
    expect(result.current.filters.privateGlobalValues).toEqual({ [GLOBAL_FILTER.id]: PRIVATE_VALUE });
    expect(result.current.changes).toMatchObject({ hasChanges: true, dirtyGlobalCount: 1 });
    expect(mockToast.error).toHaveBeenCalledWith('Could not save for everyone');
    expect(mockToast.custom).not.toHaveBeenCalled();

    // The retry lands and drops the private value.
    mockPersistThrows = false;
    act(() => {
      group = result.current.filters.saveForEveryone();
    });

    expect(group).not.toBeNull();
    expect(savedContent(host)).toBe('private');
    expect(result.current.filters.privateGlobalValues).toEqual({});
    expect(result.current.changes.hasChanges).toBe(false);
    expect(mockToast.custom).toHaveBeenCalledTimes(1);

    unmount();
    host.doc.destroy();
  });

  it('drops the private global values that were written although a widget write threw after them', () => {
    const host = createDatabase('host', DASHBOARD_VIEW_ID);
    const source = createDatabase('source-1', WIDGET.viewId);

    updateDashboardLayoutSetting(host.view, { rows: ROWS, globalFilters: [GLOBAL_FILTER] });
    const { result, unmount } = renderDashboard(host);
    const overlay = result.current.filters.getViewOverlay(WIDGET, source.view) as YDatabaseView;

    act(() => {
      result.current.filters.setPrivateGlobalValue(GLOBAL_FILTER.id, PRIVATE_VALUE);
      result.current.filters.setViewOverlayWritable(WIDGET, true);
      (overlay.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([{ id: 'mine', content: 'mine' }]);
    });
    expect(result.current.changes).toMatchObject({ dirtyGlobalCount: 1, dirtyWidgetCount: 1 });

    // The global filters write first; then the widget's source throws (an
    // observer error propagates out of its transaction).
    const boom = () => {
      throw new Error('boom');
    };

    (source.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).observe(boom);
    let group: object | null = {};

    act(() => {
      group = result.current.filters.saveForEveryone();
    });

    expect(group).toBeNull();
    expect(savedContent(host)).toBe('private');
    expect(result.current.filters.privateGlobalValues).toEqual({});
    expect(mockToast.error).toHaveBeenCalledWith('Could not save for everyone');
    expect(mockToast.custom).not.toHaveBeenCalled();

    unmount();
    [host, source].forEach(({ doc }) => doc.destroy());
  });
});
