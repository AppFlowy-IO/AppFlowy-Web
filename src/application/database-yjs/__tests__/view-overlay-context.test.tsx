import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  DatabaseViewOverlayContext,
  useDatabaseView,
} from '@/application/database-yjs/context';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { TextFilterCondition } from '@/application/database-yjs/fields';
import { useAdvancedFiltersSelector } from '@/application/database-yjs/selector';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabase, YDatabaseField, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));

const VIEW_ID = 'view-1';

function createDoc() {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const title = new Y.Map() as YDatabaseField;

  title.set(YjsDatabaseKey.id, 'title');
  title.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set('title', title);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  views.set(VIEW_ID, view);
  database.set(YjsDatabaseKey.fields, fields as never);
  database.set(YjsDatabaseKey.views, views as never);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return { doc, view };
}

function wrapperFor(doc: YDoc, overlay: YDatabaseView | undefined) {
  const value: DatabaseContextState = {
    readOnly: false,
    databaseDoc: doc,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: {},
    workspaceId: 'workspace',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseViewOverlayContext.Provider value={overlay}>
      <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
    </DatabaseViewOverlayContext.Provider>
  );
}

describe('the View-mode conditions overlay in a database context', () => {
  it('stands in only for the view it was made for', () => {
    const source = createDoc();
    const overlay = createViewConditionsOverlay(source.view);

    expect(renderHook(() => useDatabaseView(), { wrapper: wrapperFor(source.doc, overlay.view) }).result.current).toBe(
      overlay.view
    );

    // A nested context over another doc with the same view id (the calendar's
    // draft copy) keeps its own view.
    const copy = createDoc();

    expect(renderHook(() => useDatabaseView(), { wrapper: wrapperFor(copy.doc, overlay.view) }).result.current).toBe(
      copy.view
    );
    overlay.destroy();
  });

  it('shows the private advanced filters, not the shared ones', async () => {
    const { doc, view } = createDoc();
    const overlay = createViewConditionsOverlay(view);

    (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([
      {
        id: 'root',
        filter_type: FilterType.And,
        children: [
          {
            id: 'private',
            field_id: 'title',
            filter_type: FilterType.Data,
            ty: FieldType.RichText,
            condition: TextFilterCondition.TextContains,
            content: 'mine',
          },
        ],
      },
    ]);
    const { result } = renderHook(() => useAdvancedFiltersSelector(), { wrapper: wrapperFor(doc, overlay.view) });

    await waitFor(() => expect(result.current.map((filter) => filter.id)).toEqual(['private']));
    expect(view.get(YjsDatabaseKey.filters).length).toBe(0);
    overlay.destroy();
  });
});
