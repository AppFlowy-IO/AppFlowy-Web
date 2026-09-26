import { waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  YDatabase, YDatabaseField, YDatabaseFields, YDatabaseRow, YDoc,
  YjsDatabaseKey as K, YjsEditorKey as E,
} from '@/application/types';

import { CalculationType, FieldType } from '../database.type';
import { createRelationField } from '../fields/relation/utils';
import { createRollupField } from '../fields/rollup/utils';
import { evaluateRollupCell, RollupComputeContext } from '../rollup/cache';
import { observeRollupCell } from '../rollup/observe';

import { createRowDoc, setRelationCellRowIds } from './test-helpers';

function database(id: string) {
  const doc = new Y.Doc({ guid: id }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;

  doc.getMap(E.data_section).set(E.database, database);
  database.set(K.id, id);
  database.set(K.fields, fields);
  return { doc, database, fields };
}

function field(id: string, type: FieldType, expression = '') {
  const value = new Y.Map() as YDatabaseField;
  const options = new Y.Map();
  const option = new Y.Map();

  value.set(K.id, id);
  value.set(K.name, id);
  value.set(K.type, type);
  value.set(K.type_option, options);
  options.set(String(type), option);
  option.set('expression', expression);
  return value;
}

it('receives remote Formula metadata while any Rollup observer retains the related database', async () => {
  const project = database('sync-project');
  const remote = database('sync-tasks');
  const cached = new Y.Doc({ guid: remote.doc.guid }) as YDoc;

  remote.fields.set('Hours', field('Hours', FieldType.Number));
  remote.fields.set('Completed', field('Completed', FieldType.Formula, 'prop("Hours")'));
  Y.applyUpdate(cached, Y.encodeStateAsUpdate(remote.doc));
  project.fields.set('Tasks', createRelationField('Tasks', { database_id: remote.doc.guid }));
  const rollup = createRollupField('Total');

  project.fields.set('Total', rollup);
  const option = rollup.get(K.type_option).get(String(FieldType.Rollup));

  option.set(K.relation_field_id, 'Tasks');
  option.set(K.target_field_id, 'Completed');
  option.set(K.calculation_type, CalculationType.Sum);
  const owner = createRowDoc('project', project.doc.guid, { Tasks: { fieldType: FieldType.Relation } });
  const task = createRowDoc('task', remote.doc.guid, { Hours: { fieldType: FieldType.Number, data: '28' } });

  setRelationCellRowIds(owner, 'Tasks', ['task']);
  let owners = 0;
  const forward = (update: Uint8Array) => Y.applyUpdate(cached, update);
  const bindViewSync = jest.fn((doc: YDoc, options?: { retain?: boolean }) => {
    expect(doc).toBe(cached);
    expect(options?.retain).toBe(true);
    if (owners++ === 0) remote.doc.on('update', forward);
    return { doc } as SyncContext;
  });
  const scheduleDeferredCleanup = jest.fn((id: string) => {
    expect(id).toBe(cached.guid);
    if (--owners === 0) remote.doc.off('update', forward);
  });
  const context: RollupComputeContext & {
    bindViewSync: typeof bindViewSync;
    scheduleDeferredCleanup: typeof scheduleDeferredCleanup;
  } = {
    baseDoc: project.doc,
    database: project.database,
    rollupField: rollup,
    row: owner.getMap(E.data_section).get(E.database_row) as YDatabaseRow,
    rowId: 'project',
    fieldId: 'Total',
    getViewIdFromDatabaseId: async () => remote.doc.guid,
    loadView: async () => cached,
    createRow: async () => task,
    bindViewSync,
    scheduleDeferredCleanup,
  };
  let first = '';
  let second = '';
  const stopFirst = observeRollupCell(context, () => {
    void evaluateRollupCell(context).then((result) => { first = result.value; });
  });
  const stopSecond = observeRollupCell(context, () => {
    void evaluateRollupCell(context).then((result) => { second = result.value; });
  });
  const setExpression = (expression: string) =>
    remote.fields.get('Completed')!.get(K.type_option).get(String(FieldType.Formula)).set('expression', expression);

  try {
    await waitFor(() => expect([first, second]).toEqual(['28', '28']));
    setExpression('prop("Hours") * 2');
    await waitFor(() => expect([first, second]).toEqual(['56', '56']));
    expect(bindViewSync).toHaveBeenCalledTimes(2);
    stopFirst();
    expect(owners).toBe(1);
    setExpression('prop("Hours") * 3');
    await waitFor(() => expect(second).toBe('84'));
    expect(first).toBe('56');
    stopSecond();
    expect(owners).toBe(0);
    expect(scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
  } finally {
    stopFirst();
    stopSecond();
    remote.doc.off('update', forward);
    [owner, task, cached, remote.doc, project.doc].forEach((doc) => doc.destroy());
  }
});
