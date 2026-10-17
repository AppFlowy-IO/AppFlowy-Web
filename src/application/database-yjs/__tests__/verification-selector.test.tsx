import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '../context';
import { FieldType, FilterType, SortCondition } from '../database.type';
import { publishExternalDatabaseFields, registerExternalDatabaseFields } from '../external-fields';
import { createFields, createRow } from '../fields/formula/__tests__/fixture';
import { NumberFilterCondition } from '../fields/number/number.type';
import { serializeVerificationFilter, VerificationFilterCondition, VerificationFilterStatus, VerificationSnapshot } from '../fields/verification';
import { useFieldCellsByRowsSelector, useRowOrdersSelector } from '../selector';
import { YDatabase, YDatabaseFields, YDatabaseFilters, YDatabaseSorts, YDatabaseView, YDatabaseViews, YDoc, YjsDatabaseKey as K, YjsEditorKey } from '@/application/types';

function fixture(withRows = true) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([
    { id: 'number', name: 'Number', type: FieldType.Number },
    { id: 'verification', name: 'Verification', type: FieldType.Verification, typeOption: { property_id: 'generation' } },
  ]).clone() as YDatabaseFields;
  const rows = [1, 10, 3].map((value, i) => ({ id: `row-${i}`, ...createRow(`row-${i}`, {
    number: { type: FieldType.Number, data: String(value) },
    verification: { type: FieldType.RichText, data: 'preserved source' },
  }) }));
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;
  const filters = new Y.Array() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;

  filters.push([new Y.Map(Object.entries({
    id: 'verification-filter', field_id: 'verification', field_type: FieldType.Verification, filter_type: FilterType.Data,
    condition: VerificationFilterCondition.Is,
    content: serializeVerificationFilter({ condition: VerificationFilterCondition.Is, status: VerificationFilterStatus.Verified, expiresAfterMicros: null, expiresBeforeMicros: null }),
  })) as never]);
  sorts.push([new Y.Map(Object.entries({ id: 'sort', field_id: 'verification', condition: SortCondition.Ascending })) as never]);
  view.set(K.id, 'view');
  view.set(K.row_orders, Y.Array.from(rows.map(({ id }) => ({ id, height: 44 }))));
  view.set(K.filters, filters);
  view.set(K.sorts, sorts);
  views.set('view', view);
  database.set(K.id, 'database');
  database.set(K.fields, fields);
  database.set(K.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const context: DatabaseContextState = {
    databaseDoc, databasePageId: 'view', activeViewId: 'view', readOnly: false, workspaceId: 'workspace',
    rowMap: withRows ? Object.fromEntries(rows.map(({ id, doc }) => [id, doc])) : {},
  };
  const wrapper = ({ children }: { children: ReactNode }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>;
  const snapshots = new Map<string, VerificationSnapshot>([['row-0', { status: 'verified', expiresAtMicros: null }]]);
  const unregister = registerExternalDatabaseFields(fields, [{
    field: fields.get('verification'),
    readVerificationSnapshot: (id) => snapshots.get(id),
    readValue: (id) => { const value = snapshots.get(id);

 return value ? value.status === 'unverified' ? '' : value.status === 'verified' ? 'Verified' : 'Expired' : undefined; },
  }]);

  return { databaseDoc, fields, filters, sorts, rows, snapshots, unregister, wrapper };
}

const useIds = () => useRowOrdersSelector()?.map(({ id }) => id);

it.each([false, true])('evaluates Cloud-only filters before/after row document loading (loaded: %s)', async (withRows) => {
  const f = fixture(withRows);
  const opened = renderHook(useIds, { wrapper: f.wrapper });

  await waitFor(() => expect(opened.result.current).toEqual(['row-0']));
  await act(async () => {
    f.snapshots.set('row-2', { status: 'verified', expiresAtMicros: 10n });
    publishExternalDatabaseFields(f.fields);
    await Promise.resolve();
  });
  await waitFor(() => expect(opened.result.current).toEqual(['row-2', 'row-0']));
  await act(async () => { f.unregister(); await Promise.resolve(); });
  await waitFor(() => expect(opened.result.current).toEqual([]));
  opened.unmount();
});

it('recomputes the complete OR tree on claim changes and after reopening', async () => {
  const f = fixture();
  const leaf = f.filters.get(0).toJSON();

  f.filters.delete(0);
  f.filters.push([new Y.Map(Object.entries({ id: 'or', filter_type: FilterType.Or, children: [leaf, {
    id: 'number-filter', field_id: 'number', field_type: FieldType.Number, filter_type: FilterType.Data,
    condition: NumberFilterCondition.GreaterThan, content: '5',
  }] })) as never]);
  const before = f.databaseDoc.toJSON();
  const opened = renderHook(useIds, { wrapper: f.wrapper });

  await waitFor(() => expect(opened.result.current).toEqual(['row-0', 'row-1']));
  await act(async () => {
    f.snapshots.delete('row-0');
    f.snapshots.set('row-2', { status: 'verified', expiresAtMicros: null });
    publishExternalDatabaseFields(f.fields);
    await Promise.resolve();
  });
  await waitFor(() => expect(opened.result.current).toEqual(['row-2', 'row-1']));
  opened.unmount();
  const reopened = renderHook(useIds, { wrapper: f.wrapper });

  await waitFor(() => expect(reopened.result.current).toEqual(['row-2', 'row-1']));
  expect(f.databaseDoc.toJSON()).toEqual(before);
  reopened.unmount();
  f.unregister();
});

it('keeps unavailable calculations unknown instead of using preserved source cells', async () => {
  const f = fixture();
  const rows = f.rows.map(({ id }) => ({ id, height: 44 }));
  const opened = renderHook(() => useFieldCellsByRowsSelector('verification', rows), { wrapper: f.wrapper });

  await waitFor(() => expect(opened.result.current.cells).toBeNull());
  await act(async () => {
    f.snapshots.set('row-1', { status: 'expired', expiresAtMicros: 1n });
    f.snapshots.set('row-2', { status: 'unverified', expiresAtMicros: null });
    publishExternalDatabaseFields(f.fields);
    await Promise.resolve();
  });
  await waitFor(() => expect([...opened.result.current.cells!.values()]).toEqual(['Verified', 'Expired', '']));
  await act(async () => { f.unregister(); await Promise.resolve(); });
  await waitFor(() => expect(opened.result.current.cells).toBeNull());
  expect(f.rows[0].row.get(K.cells).get('verification').get(K.data)).toBe('preserved source');
  opened.unmount();
});
