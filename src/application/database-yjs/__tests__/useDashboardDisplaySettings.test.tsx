import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, useDashboardDisplaySettings } from '@/application/database-yjs';
import { createDashboardRow, createDashboardWidget, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const VIEW_ID = 'dashboard-view';

function createFixture() {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  views.set(VIEW_ID, view);
  return { doc, view };
}

function renderDisplaySettings(doc: YDoc) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: doc,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: {},
    workspaceId: 'workspace-id',
  };
  let renders = 0;
  const rendered = renderHook(
    () => {
      renders += 1;
      return useDashboardDisplaySettings();
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
      ),
    }
  );

  return { ...rendered, renders: () => renders };
}

describe('useDashboardDisplaySettings', () => {
  it('reads both display flags and follows each of them', () => {
    const { doc, view } = createFixture();
    const { result, unmount } = renderDisplaySettings(doc);

    // The defaults: titles shown, no icons in the headings.
    expect(result.current).toEqual({ showWidgetTitles: true, showIconsInHeading: false });

    act(() => doc.transact(() => updateDashboardLayoutSetting(view, { showWidgetTitles: false })));
    expect(result.current).toEqual({ showWidgetTitles: false, showIconsInHeading: false });

    act(() => doc.transact(() => updateDashboardLayoutSetting(view, { showIconsInHeading: true })));
    expect(result.current).toEqual({ showWidgetTitles: false, showIconsInHeading: true });

    unmount();
    doc.destroy();
  });

  it('keeps one observer on the document for both flags and releases it on unmount', () => {
    const { doc } = createFixture();
    const root = doc.getMap(YjsEditorKey.data_section);
    const observeDeep = jest.spyOn(root, 'observeDeep');
    const unobserveDeep = jest.spyOn(root, 'unobserveDeep');
    const { unmount } = renderDisplaySettings(doc);

    expect(observeDeep).toHaveBeenCalledTimes(1);

    unmount();
    expect(unobserveDeep).toHaveBeenCalledTimes(1);
    doc.destroy();
  });

  it('does not re-render the caller for a row edit of the dashboard', () => {
    const { doc, view } = createFixture();
    const { result, renders, unmount } = renderDisplaySettings(doc);
    const settings = result.current;
    const rendersBefore = renders();

    act(() =>
      doc.transact(() =>
        updateDashboardLayoutSetting(view, {
          rows: [createDashboardRow([createDashboardWidget('grid-view', 'database-id')])],
        })
      )
    );

    expect(renders()).toBe(rendersBefore);
    expect(result.current).toBe(settings);

    unmount();
    doc.destroy();
  });
});
