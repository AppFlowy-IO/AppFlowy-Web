import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ReactElement } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardGlobalFilter, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import {
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
  useDashboardPrivateSummary,
} from '@/components/database/dashboard/DashboardContext';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

import { useGlobalFilterActions } from '../useGlobalFilterActions';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));

jest.mock('sonner', () => ({ toast: { custom: jest.fn(), dismiss: jest.fn() } }));

const mockToast = (jest.requireMock('sonner') as { toast: { custom: jest.Mock; dismiss: jest.Mock } }).toast;

const DASHBOARD_VIEW_ID = 'dashboard-view';
const WIDGET_VIEW_ID = 'widget-view';
const GLOBAL_FILTER: DashboardGlobalFilter = {
  id: 'global-filter',
  name: 'Name',
  fieldType: FieldType.RichText,
  condition: 0,
  content: 'saved',
  targets: { 'source-1': 'name' },
};

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

function SaveButton() {
  const { saveForEveryone } = useDashboardFilters();

  return <button onClick={() => saveForEveryone()}>Save for everyone</button>;
}

function conditions(view: YDatabaseView) {
  return {
    filters: view.get(YjsDatabaseKey.filters).toJSON(),
    sorts: view.get(YjsDatabaseKey.sorts).toJSON(),
  };
}

const EMPTY_CONDITIONS = { filters: [], sorts: [] };

beforeEach(() => {
  mockToast.custom.mockClear();
  mockToast.dismiss.mockClear();
});

describe('Save for everyone history', () => {
  it.each([
    { sourceCount: 1, saveGlobalFilters: false },
    { sourceCount: 2, saveGlobalFilters: false },
    { sourceCount: 2, saveGlobalFilters: true },
  ])(
    'undoes and redoes $sourceCount foreign sources from the dashboard (global filters: $saveGlobalFilters)',
    ({ sourceCount, saveGlobalFilters }) => {
      const host = createDatabase('host', DASHBOARD_VIEW_ID);
      const sources = Array.from({ length: sourceCount }, (_, index) =>
        createDatabase(`source-${index + 1}`, WIDGET_VIEW_ID)
      );
      const readOnly = createDatabase('read-only-source', WIDGET_VIEW_ID);
      const widgets = [...sources, readOnly].map((source, index) => ({
        id: `widget-${index}`,
        viewId: WIDGET_VIEW_ID,
        databaseId: source.database.get(YjsDatabaseKey.id),
        width: 12 / (sourceCount + 1),
      }));
      const rows: DashboardRow[] = [{ id: 'row', height: 360, widgets }];

      updateDashboardLayoutSetting(host.view, { rows, globalFilters: [GLOBAL_FILTER] });
      const hostHistory = getOrCreateDatabaseHistoryManager(host.doc);
      const sourceHistories = sources.map((source) => getOrCreateDatabaseHistoryManager(source.doc));

      sources.forEach((source) => {
        runDatabaseAction(source.doc, { type: 'test.earlierSourceEdit' }, () => {
          source.view.set(YjsDatabaseKey.name, 'Earlier source edit');
        });
      });

      const { result, unmount } = renderHook(
        () => ({
          dashboard: useDashboardContext(),
          filters: useDashboardFilters(),
          changes: useDashboardPrivateSummary(),
          actions: useGlobalFilterActions(),
        }),
        {
          wrapper: ({ children }) => (
            <DatabaseContext.Provider value={context(host.doc, DASHBOARD_VIEW_ID)}>
              <DatabaseHistoryScope>
                <DashboardProvider>
                  {children}
                  <SaveButton />
                  <DatabaseContext.Provider value={context(sources[0].doc, WIDGET_VIEW_ID)}>
                    <DatabaseHistoryScope>
                      <button>Source widget</button>
                    </DatabaseHistoryScope>
                  </DatabaseContext.Provider>
                </DashboardProvider>
              </DatabaseHistoryScope>
            </DatabaseContext.Provider>
          ),
        }
      );

      // The save must not accidentally undo this older dashboard layout action.
      act(() => {
        result.current.dashboard.updateRows((current) => current.map((row) => ({ ...row, height: 480 })));
      });
      const earlierLayout = readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID);
      const overlays = [...sources, readOnly].map((source, index) =>
        result.current.filters.getViewOverlay(widgets[index], source.view) as YDatabaseView
      );
      const privateConditions = overlays.map((_, index) => ({
        filters: [{ id: `filter-${index}`, content: 'private' }],
        sorts: [{ id: `sort-${index}`, field_id: 'name', condition: 1 }],
      }));

      act(() => {
        overlays.forEach((overlay, index) => {
          result.current.filters.setViewOverlayWritable(widgets[index], index < sourceCount);
          (overlay.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push(privateConditions[index].filters);
          (overlay.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push(privateConditions[index].sorts);
        });
        if (saveGlobalFilters) {
          result.current.actions.setFilterValue(GLOBAL_FILTER.id, (filter) => ({ ...filter, content: 'private' }));
        }
      });
      expect(result.current.changes).toMatchObject({
        dirtyWidgetCount: sourceCount + 1,
        savableWidgetCount: sourceCount,
      });
      sources.forEach((source) => expect(conditions(source.view)).toEqual(EMPTY_CONDITIONS));

      const sourceWidget = screen.getByRole('button', { name: 'Source widget' });
      const saveButton = screen.getByRole('button', { name: 'Save for everyone' });

      fireEvent.pointerDown(sourceWidget);
      fireEvent.pointerDown(saveButton);
      fireEvent.click(saveButton);

      sources.forEach((source, index) => expect(conditions(source.view)).toEqual(privateConditions[index]));
      expect(conditions(readOnly.view)).toEqual(EMPTY_CONDITIONS);
      expect(conditions(overlays[sourceCount])).toEqual(privateConditions[sourceCount]);
      expect(result.current.changes).toMatchObject({ dirtyWidgetCount: 1, savableWidgetCount: 0 });
      expect(result.current.changes.canSave).toBe(false);
      const savedLayout = readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID);

      expect(savedLayout.globalFilters).toEqual([
        { ...GLOBAL_FILTER, content: saveGlobalFilters ? 'private' : 'saved' },
      ]);

      const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };
      const undoKey = { key: 'z', code: 'KeyZ', keyCode: 90, which: 90, ...modifier };

      // A single keyboard undo reverses every saved source and the optional
      // global change while preserving older dashboard and source actions.
      fireEvent.keyDown(saveButton, undoKey);
      sources.forEach((source, index) => {
        expect(conditions(source.view)).toEqual(EMPTY_CONDITIONS);
        expect(conditions(overlays[index])).toEqual(EMPTY_CONDITIONS);
        expect(source.view.get(YjsDatabaseKey.name)).toBe('Earlier source edit');
        expect(sourceHistories[index].canUndo()).toBe(true);
      });
      expect(readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID)).toEqual(earlierLayout);
      expect(conditions(overlays[sourceCount])).toEqual(privateConditions[sourceCount]);

      fireEvent.keyDown(saveButton, { ...undoKey, shiftKey: true });
      sources.forEach((source, index) => expect(conditions(source.view)).toEqual(privateConditions[index]));
      expect(readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID)).toEqual(savedLayout);
      expect(conditions(readOnly.view)).toEqual(EMPTY_CONDITIONS);
      expect(conditions(overlays[sourceCount])).toEqual(privateConditions[sourceCount]);

      // The save occupies exactly one dashboard step, immediately above the
      // older layout edit, even when it touches several different documents.
      fireEvent.keyDown(saveButton, undoKey);
      fireEvent.keyDown(saveButton, undoKey);
      expect(readDashboardLayoutSetting(host.database, DASHBOARD_VIEW_ID).rows).toEqual(rows);
      expect(hostHistory.canUndo()).toBe(false);

      unmount();
      [host, ...sources, readOnly].forEach(({ doc }) => doc.destroy());
    }
  );

  it('records no dashboard step when the saved global filters are unchanged', () => {
    const host = createDatabase('host', DASHBOARD_VIEW_ID);
    const source = createDatabase('source-1', WIDGET_VIEW_ID);
    const rows: DashboardRow[] = [
      { id: 'row', height: 360, widgets: [{ id: 'widget', viewId: WIDGET_VIEW_ID, databaseId: 'source-1', width: 12 }] },
    ];

    updateDashboardLayoutSetting(host.view, { rows, globalFilters: [GLOBAL_FILTER] });
    const hostHistory = getOrCreateDatabaseHistoryManager(host.doc);
    const storedFilters = () =>
      host.view.get(YjsDatabaseKey.layout_settings).get('9').get(YjsDatabaseKey.dashboard_global_filters);
    const before = storedFilters();
    const { result, unmount } = renderHook(() => useDashboardFilters(), {
      wrapper: ({ children }) => (
        <DatabaseContext.Provider value={context(host.doc, DASHBOARD_VIEW_ID)}>
          <DatabaseHistoryScope>
            <DashboardProvider>{children}</DashboardProvider>
          </DatabaseHistoryScope>
        </DatabaseContext.Provider>
      ),
    });

    // Publishing filters equal to the saved ones writes nothing (Notion records no step either).
    act(() => result.current.commitViewOverlays([{ ...GLOBAL_FILTER, targets: { ...GLOBAL_FILTER.targets } }]));

    expect(storedFilters()).toBe(before);
    expect(hostHistory.canUndo()).toBe(false);

    unmount();
    [host, source].forEach(({ doc }) => doc.destroy());
  });

  it('the toast offers Undo for exactly that save, while it is the latest step', () => {
    const host = createDatabase('host', DASHBOARD_VIEW_ID);
    const source = createDatabase('source-1', WIDGET_VIEW_ID);
    const widget = { id: 'widget', viewId: WIDGET_VIEW_ID, databaseId: 'source-1', width: 12 };

    updateDashboardLayoutSetting(host.view, { rows: [{ id: 'row', height: 360, widgets: [widget] }], globalFilters: [GLOBAL_FILTER] });
    const hostHistory = getOrCreateDatabaseHistoryManager(host.doc);
    const { result, unmount } = renderHook(() => useDashboardFilters(), {
      wrapper: ({ children }) => (
        <DatabaseContext.Provider value={context(host.doc, DASHBOARD_VIEW_ID)}>
          <DatabaseHistoryScope>
            <DashboardProvider>{children}</DashboardProvider>
          </DatabaseHistoryScope>
        </DatabaseContext.Provider>
      ),
    });
    const overlay = result.current.getViewOverlay(widget, source.view) as YDatabaseView;

    act(() => {
      result.current.setViewOverlayWritable(widget, true);
      (overlay.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([{ id: 'sort', field_id: 'name', condition: 1 }]);
    });
    act(() => {
      result.current.saveForEveryone({ widget });
    });
    expect(conditions(source.view).sorts).toHaveLength(1);
    expect(mockToast.custom).toHaveBeenCalledTimes(1);

    // Render the toast and click its Undo.
    const [renderToast, options] = mockToast.custom.mock.calls[0] as [() => ReactElement, { id: string; duration: number }];

    expect(options).toMatchObject({ id: 'dashboard-saved-for-everyone', duration: 5000 });
    render(renderToast());
    expect(screen.getByTestId('dashboard-saved-toast').textContent).toContain('Changes saved for everyone.');
    act(() => {
      fireEvent.click(screen.getByTestId('dashboard-saved-toast-undo'));
    });
    expect(conditions(source.view)).toEqual(EMPTY_CONDITIONS);
    expect(mockToast.dismiss).toHaveBeenCalledWith('dashboard-saved-for-everyone');
    expect(hostHistory.canUndo()).toBe(false);

    unmount();
    [host, source].forEach(({ doc }) => doc.destroy());
  });
});
