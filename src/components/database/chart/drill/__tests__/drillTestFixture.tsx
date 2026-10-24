/**
 * A small "Bug Tracker" database for the drill-down tests: real Y docs, a
 * chart view grouped by Severity, and the database context around them.
 */
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { AFConfigContext } from '@/components/main/app.hooks';
import {
  DatabaseViewLayout,
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

export const DATABASE_ID = 'bug-tracker';
export const CHART_VIEW_ID = 'by-severity';

export const STATUS_OPTIONS = [
  { id: 'o_new', name: 'New', color: 0 },
  { id: 'o_doing', name: 'Doing', color: 1 },
  { id: 'o_done', name: 'Done', color: 2 },
];
export const SEVERITY_OPTIONS = [
  { id: 'o_blocker', name: 'Blocker', color: 0 },
  { id: 'o_major', name: 'Major', color: 1 },
];
export const COMPONENT_OPTIONS = [
  { id: 'o_web', name: 'Frontend', color: 0 },
  { id: 'o_mobile', name: 'Mobile', color: 1 },
];

export const ROWS: Array<{ id: RowId; name: string; status: string; severity: string; component: string }> = [
  { id: 'r1', name: 'Login fails on Safari', status: 'o_new', severity: 'o_blocker', component: 'o_web' },
  { id: 'r2', name: 'Crash on photo upload', status: 'o_doing', severity: 'o_blocker', component: 'o_mobile' },
  { id: 'r3', name: 'Token refresh race', status: 'o_new', severity: 'o_major', component: 'o_web' },
  { id: 'r4', name: 'Typo on pricing page', status: 'o_done', severity: 'o_major', component: 'o_web' },
];

/** A field map not yet in a doc (the shared test helper builds root types of their own doc). */
export function makeField(id: string, type: FieldType, name: string, typeOptionContent?: unknown): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, type);
  if (typeOptionContent !== undefined) {
    const typeOptions = new Y.Map();
    const option = new Y.Map();

    option.set(YjsDatabaseKey.content, JSON.stringify(typeOptionContent));
    typeOptions.set(String(type), option);
    field.set(YjsDatabaseKey.type_option, typeOptions);
  }

  return field;
}

function selectField(id: string, name: string, options: typeof STATUS_OPTIONS) {
  return makeField(id, FieldType.SingleSelect, name, { options, disable_color: false });
}

export function selectFilterPlain(id: string, fieldId: string, optionId: string) {
  return {
    id,
    filter_type: FilterType.Data,
    field_id: fieldId,
    ty: FieldType.SingleSelect,
    condition: SelectOptionFilterCondition.OptionIs,
    content: optionId,
  };
}

export function toYFilter(plain: Record<string, unknown>) {
  const map = new Y.Map<unknown>();

  Object.entries(plain).forEach(([key, value]) => map.set(key, value));
  return map;
}

export interface DrillFixture {
  doc: YDoc;
  database: YDatabase;
  view: YDatabaseView;
  rowMap: Record<RowId, YDoc>;
  fields: Y.Map<YDatabaseField>;
}

export function createDrillFixture({ chart = true }: { chart?: boolean } = {}): DrillFixture {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const name = makeField('name', FieldType.RichText, 'Name');

  name.set(YjsDatabaseKey.is_primary, true);
  fields.set('name', name);
  fields.set('status', selectField('status', 'Status', STATUS_OPTIONS));
  fields.set('severity', selectField('severity', 'Severity', SEVERITY_OPTIONS));
  fields.set('component', selectField('component', 'Component', COMPONENT_OPTIONS));

  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push([{ id: 'name' }, { id: 'status' }, { id: 'severity' }, { id: 'component' }]);
  const rowOrders = new Y.Array<{ id: RowId; height: number }>();

  rowOrders.push(ROWS.map((row) => ({ id: row.id, height: 36 })));
  view.set(YjsDatabaseKey.id, CHART_VIEW_ID);
  view.set(YjsDatabaseKey.name, 'By severity');
  view.set(YjsDatabaseKey.layout, chart ? DatabaseViewLayout.Chart : DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, new Y.Map());
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  const layoutSettings = new Y.Map<unknown>();
  const chartSettings = new Y.Map<unknown>();

  chartSettings.set('chart_type', 0);
  chartSettings.set('x_field_id', 'severity');
  layoutSettings.set('3', chartSettings);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(CHART_VIEW_ID, view);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowMap: Record<RowId, YDoc> = {};

  ROWS.forEach((row) => {
    rowMap[row.id] = createRowDoc(row.id, DATABASE_ID, {
      name: createCell(FieldType.RichText, row.name),
      status: createCell(FieldType.SingleSelect, row.status),
      severity: createCell(FieldType.SingleSelect, row.severity),
      component: createCell(FieldType.SingleSelect, row.component),
    });
  });

  return { doc, database, view, rowMap, fields };
}

export function setCell(fixture: DrillFixture, rowId: RowId, fieldId: string, data: string) {
  const row = fixture.rowMap[rowId].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown>;
  const cell = (row.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>>).get(fieldId);

  cell?.set(YjsDatabaseKey.data, data);
}

export function contextOf(fixture: DrillFixture, overrides: Partial<DatabaseContextState> = {}): DatabaseContextState {
  return {
    readOnly: false,
    canWrite: true,
    databaseDoc: fixture.doc,
    databasePageId: CHART_VIEW_ID,
    activeViewId: CHART_VIEW_ID,
    rowMap: fixture.rowMap,
    workspaceId: 'workspace',
    seedsReady: true,
    blobPrefetchComplete: true,
    ...overrides,
  };
}

const AF_CONFIG = { isAuthenticated: false, updateCurrentUser: async () => undefined, openLoginModal: () => undefined };

export function DatabaseWrapper({ value, children }: { value: DatabaseContextState; children: ReactNode }) {
  return (
    <AFConfigContext.Provider value={AF_CONFIG}>
      <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}
