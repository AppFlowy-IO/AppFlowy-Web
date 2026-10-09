import { act, renderHook } from '@testing-library/react';
import { ReactNode, useContext } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';

import {
  DashboardProvider,
  useDashboardContext,
  useDashboardFilters,
  useDashboardPrivateSummary,
} from '../../DashboardContext';
import { WidgetPrivateContext, WidgetPrivateResolver } from '../WidgetPrivateContext';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));

const DASHBOARD_VIEW_ID = 'dashboard-view';
const WIDGET = { id: 'widget', databaseId: 'source', viewId: 'widget-view' };
const ROWS: DashboardRow[] = [{ id: 'row', height: 360, widgets: [{ ...WIDGET, width: 12 }] }];

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

describe('widget private handles across a remove and an undo', () => {
  it('rebinds the handle to the record the store recreates for a widget brought back', () => {
    const host = createDatabase('host', DASHBOARD_VIEW_ID);
    const source = createDatabase('source', WIDGET.viewId);

    updateDashboardLayoutSetting(host.view, { rows: ROWS });
    const { result, unmount } = renderHook(
      () => ({
        dashboard: useDashboardContext(),
        filters: useDashboardFilters(),
        changes: useDashboardPrivateSummary(),
        resolver: useContext(WidgetPrivateContext) as WidgetPrivateResolver,
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DatabaseContext.Provider value={context(host.doc, DASHBOARD_VIEW_ID)}>
            <DatabaseHistoryScope>
              <DashboardProvider>{children}</DashboardProvider>
            </DatabaseHistoryScope>
          </DatabaseContext.Provider>
        ),
      }
    );
    const before = result.current.resolver.getWidgetPrivateHandle(WIDGET);

    // Stable while the widget stays on the dashboard.
    expect(result.current.resolver.getWidgetPrivateHandle(WIDGET)).toBe(before);

    // The widget leaves the rows (Delete) and comes back with the same id,
    // database and view (undo): the store dropped its record meanwhile.
    act(() => {
      result.current.dashboard.updateRows(() => []);
    });
    act(() => {
      result.current.dashboard.updateRows(() => ROWS);
    });
    act(() => result.current.dashboard.setEditing(false));
    const after = result.current.resolver.getWidgetPrivateHandle(WIDGET);
    const listener = jest.fn();

    expect(after).not.toBe(before);
    expect(result.current.resolver.getWidgetPrivateHandle(WIDGET)).toBe(after);
    after.subscribe(listener);
    const overlay = result.current.filters.getViewOverlay(WIDGET, source.view) as YDatabaseView;

    act(() => {
      (overlay.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([{ id: 'mine', content: 'mine' }]);
    });

    // The remounted widget's dots and footer follow its private change.
    expect(after.getSnapshot()).toMatchObject({ filters: true, sorts: false, suspended: false });
    expect(listener).toHaveBeenCalled();
    expect(result.current.changes).toMatchObject({ hasChanges: true, dirtyWidgetCount: 1 });

    unmount();
    [host, source].forEach(({ doc }) => doc.destroy());
  });
});
