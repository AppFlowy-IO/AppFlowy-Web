import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  DatabaseExtraFiltersContext,
  DatabaseViewOverlayContext,
} from '@/application/database-yjs/context';
import { DashboardExtraFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch/row';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/main/app.hooks', () => ({
  ...jest.requireActual('@/components/main/app.hooks'),
  useCurrentUser: () => undefined,
  useCurrentUserOptional: () => undefined,
}));

function field(id: string, type: FieldType, options?: { id: string; name: string }[]) {
  const map = new Y.Map<unknown>() as YDatabaseField;

  map.set(YjsDatabaseKey.id, id);
  map.set(YjsDatabaseKey.name, id);
  map.set(YjsDatabaseKey.type, type);
  if (options) {
    const typeOptions = new Y.Map<unknown>();
    const option = new Y.Map<unknown>();

    option.set(
      'content',
      JSON.stringify({ options: options.map((item) => ({ ...item, color: 'Purple' })), disable_color: false })
    );
    typeOptions.set(String(type), option);
    map.set(YjsDatabaseKey.type_option, typeOptions);
  }

  return map;
}

function createDatabase() {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'db');
  database.set(YjsDatabaseKey.fields, fields as never);
  database.set(YjsDatabaseKey.views, views as never);
  fields.set('name', field('name', FieldType.RichText));
  fields.set('stage', field('stage', FieldType.SingleSelect, [{ id: 'o-doing', name: 'Doing' }]));
  fields.set('blocked', field('blocked', FieldType.Checkbox));
  views.set('v1', view);
  view.set(YjsDatabaseKey.id, 'v1');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.filters, new Y.Array() as never);
  view.set(YjsDatabaseKey.sorts, new Y.Array() as never);
  view.set(YjsDatabaseKey.row_orders, new Y.Array() as never);
  getOrCreateDatabaseHistoryManager(doc);
  return { doc, view, fields };
}

const STAGE_IS_DOING: DashboardExtraFilter = {
  id: 'gf:stage',
  filter_type: FilterType.Data,
  field_id: 'stage',
  ty: FieldType.SingleSelect,
  condition: 0,
  content: 'o-doing',
};

function render(doc: YDoc, overlayView: YDatabaseView | undefined, extra: DashboardExtraFilter[] | undefined) {
  const rowDocs: Record<string, YDoc> = {};
  const navigateToRow = jest.fn();
  const context: DatabaseContextState = {
    databaseDoc: doc,
    databasePageId: 'v1',
    activeViewId: 'v1',
    readOnly: false,
    rowMap: rowDocs,
    workspaceId: 'workspace',
    isDashboardWidget: true,
    navigateToRow,
    createRow: async (key: string) => {
      const rowDoc = new Y.Doc({ guid: key }) as YDoc;

      rowDocs[key] = rowDoc;
      return rowDoc;
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>
      <DatabaseViewOverlayContext.Provider value={overlayView}>
        <DatabaseExtraFiltersContext.Provider value={extra}>{children}</DatabaseExtraFiltersContext.Provider>
      </DatabaseViewOverlayContext.Provider>
    </DatabaseContext.Provider>
  );
  const { result } = renderHook(() => useNewRowDispatch(), { wrapper });

  return { result, rowDocs, navigateToRow };
}

function cellData(rowDoc: YDoc, fieldId: string) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId)?.get(YjsDatabaseKey.data);
}

describe('useNewRowDispatch prefills from the effective filters (WP07 P0-5)', () => {
  it('prefills from overlay and extra (global) filters', async () => {
    const { doc, view } = createDatabase();
    const overlay = createViewConditionsOverlay(view);
    const blocked = new Y.Map<unknown>();

    blocked.set(YjsDatabaseKey.id, 'private-blocked');
    blocked.set(YjsDatabaseKey.filter_type, FilterType.Data);
    blocked.set(YjsDatabaseKey.field_id, 'blocked');
    blocked.set(YjsDatabaseKey.type, FieldType.Checkbox);
    blocked.set(YjsDatabaseKey.condition, 0);
    blocked.set(YjsDatabaseKey.content, '');
    (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([blocked]);

    const { result, rowDocs, navigateToRow } = render(doc, overlay.view, [STAGE_IS_DOING]);
    let rowId: string | null = null;

    await act(async () => {
      rowId = await result.current({});
    });
    const rowDoc = Object.values(rowDocs)[0];

    expect(rowId).toEqual(expect.any(String));
    expect(cellData(rowDoc, 'stage')).toBe('o-doing');
    expect(cellData(rowDoc, 'blocked')).toBe('Yes');
    // Filters are active (here only private and global ones): the new row opens.
    expect(navigateToRow).toHaveBeenCalledWith(rowId);
    // The saved view keeps no filter.
    expect(view.get(YjsDatabaseKey.filters).length).toBe(0);
    overlay.destroy();
  });

  it('a global filter whose field was retyped does not prefill', async () => {
    const { doc, fields } = createDatabase();

    fields.set('stage', field('stage', FieldType.RichText));
    const { result, rowDocs, navigateToRow } = render(doc, undefined, [STAGE_IS_DOING]);

    await act(async () => {
      await result.current({});
    });
    const rowDoc = Object.values(rowDocs)[0];

    expect(cellData(rowDoc, 'stage')).toBeUndefined();
    expect(navigateToRow).not.toHaveBeenCalled();
  });
});
