import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType } from '@/application/database-yjs/database.type';
import { readFormulaSchema, type FormulaExternalReferences } from '@/application/database-yjs/fields/formula';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { useRollupFieldObservers } from '@/application/database-yjs/hooks/useRollupFieldObservers';
import { markDatabaseHistoryDocumentImmutable } from '@/application/database-yjs/immutable';
import * as relationCache from '@/application/database-yjs/relation/cache';
import * as rollupCache from '@/application/database-yjs/rollup/cache';
import { MentionablePerson, YDatabase, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

import { formulaRowContext, historicalFormulaRowContext, memberNames, useFormulaReadContext } from './read-context';
import { useFormulaRelationTitles } from './useFormulaRelationTitles';

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: jest.fn(() => ({
    users: [{ uid: '42', person_id: 'person', name: 'Current workspace name' }],
  })),
}));

function fixture() {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([
    { id: 'title', name: 'Title', type: FieldType.RichText },
    { id: 'relation', name: 'Relation', type: FieldType.Relation, typeOption: { database_id: 'database' } },
    { id: 'external', name: 'External', type: FieldType.Relation, typeOption: { database_id: 'other-database' } },
    { id: 'rollup', name: 'Total', type: FieldType.Rollup,
      typeOption: { relation_field_id: 'relation', target_field_id: 'number', calculation_type: CalculationType.Sum } },
  ]).clone() as YDatabaseFields;
  const { row, doc } = createRow('row', {
    relation: { type: FieldType.Relation, data: { yArray: ['related'] } },
    rollup: { type: FieldType.Rollup, data: '', extra: { data: 17 } },
  });
  const related = createRow('related', { title: { type: FieldType.RichText, data: 'Saved title' } });

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  fields.get('title').set(YjsDatabaseKey.is_primary, true);
  const rows = { row: doc, related: related.doc };

  [databaseDoc, ...Object.values(rows)].forEach(markDatabaseHistoryDocumentImmutable);
  const loaders = {
    loadView: jest.fn(async () => databaseDoc),
    createRow: jest.fn(async () => related.doc),
    getViewIdFromDatabaseId: jest.fn(async () => 'live-view'),
  };
  const context: DatabaseContextState = {
    ...loaders, databaseDoc, dataSource: { type: 'history', id: 'history' },
    databasePageId: 'view', activeViewId: 'view', rowMap: rows, readOnly: true, workspaceId: 'workspace',
  };
  const schema = readFormulaSchema(fields);
  const references: FormulaExternalReferences = {
    people: true, clock: true,
    relations: schema.filter((field) => field.type === FieldType.Relation),
    rollups: schema.filter((field) => field.type === FieldType.Rollup),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { databaseDoc, database, fields, row, rows, loaders, context, references, wrapper };
}

afterEach(() => jest.restoreAllMocks());

it('reads snapshot relation titles and stored rollups without current member names', () => {
  const f = fixture();
  const context = historicalFormulaRowContext('row', f.row, {
    database: f.database, baseDoc: f.databaseDoc, rows: f.rows,
  });

  expect(context.getUserName).toBeUndefined();
  expect(context.getPersonName).toBeUndefined();
  expect(context.getRelatedRowTitle?.(f.fields.get('relation'), 'related')).toBe('Saved title');
  expect(context.getRelatedRowTitle?.(f.fields.get('relation'), 'missing')).toBe('missing');
  expect(context.getRelatedRowTitle?.(f.fields.get('external'), 'related')).toBe('related');
  expect(context.getRollupValue?.('rollup')).toEqual({ value: '17', rawNumeric: 17 });

  const fallback = formulaRowContext('row', f.row, {
    database: f.database, baseDoc: f.databaseDoc, rows: f.rows, loaders: f.loaders,
    members: memberNames([{ uid: '42', person_id: 'person', name: 'Current workspace name' } as MentionablePerson]),
  });

  expect(fallback.getUserName).toBeUndefined();
  expect(fallback.getPersonName).toBeUndefined();
  expect(fallback.getRelatedRowTitle?.(f.fields.get('relation'), 'related')).toBe('Saved title');
});

it.each([true, false])('ignores warm live caches and never subscribes or loads historical dependencies (explicit source: %s)', (explicitSource) => {
  const f = fixture();

  if (!explicitSource) f.context.dataSource = undefined;
  const liveTitle = jest.spyOn(relationCache, 'readFormulaRelationTitle').mockReturnValue('Current title');
  const lookup = jest.spyOn(relationCache, 'ensureRelationGroupLabel');
  const retain = jest.spyOn(relationCache, 'retainRelationGroupLabels');
  const titleSubscribe = jest.spyOn(relationCache, 'subscribeRelationGroupLabel');
  const rollupSubscribe = jest.spyOn(rollupCache, 'subscribeRollupCell');
  const rollupInvalidate = jest.spyOn(rollupCache, 'invalidateRollupCell');
  const liveRollup = jest.spyOn(rollupCache, 'readRollupCell').mockResolvedValue({ value: '999', rawNumeric: 999 });
  const interval = jest.spyOn(global, 'setInterval');
  const getCachedRowDocs = jest.fn(() => f.rows);
  const subscribeToCachedRowDocChanges = jest.fn(() => () => undefined);
  const onConditionsChange = jest.fn();
  const { result, unmount } = renderHook(() => {
    useFormulaRelationTitles(f.references.relations, {
      rows: f.rows, getCachedRowDocs, subscribeToCachedRowDocChanges,
    });
    useRollupFieldObservers(onConditionsChange, 0, { rows: f.rows, rollupFieldIds: ['rollup'] });
    return useFormulaReadContext({ references: f.references, row: f.row, rowId: 'row', rowClock: 0 });
  }, { wrapper: f.wrapper });

  expect(result.current.context.getRelatedRowTitle?.(f.fields.get('relation'), 'related')).toBe('Saved title');
  expect(result.current.context.getRelatedRowTitle?.(f.fields.get('external'), 'related')).toBe('related');
  expect(result.current.context.getRollupValue?.('rollup')).toEqual({ value: '17', rawNumeric: 17 });
  expect(result.current.context.getUserName).toBeUndefined();
  expect(result.current.context.getPersonName).toBeUndefined();
  expect(result.current.revision).toBe('0:0');
  expect(useMentionableUsersWithAutoFetch).toHaveBeenLastCalledWith(false);
  [liveTitle, lookup, retain, titleSubscribe, liveRollup, rollupSubscribe, rollupInvalidate, interval,
    getCachedRowDocs, subscribeToCachedRowDocChanges, onConditionsChange, ...Object.values(f.loaders)]
    .forEach((operation) => expect(operation).not.toHaveBeenCalled());
  unmount();
});
