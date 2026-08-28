import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import {
  ensureRelationGroupLabel,
  getRelationGroupLabelRevision,
  readRelationCellText,
  readRelationGroupLabel,
  retainRelationGroupLabels,
  subscribeRelationCache,
  subscribeRelationGroupLabels,
} from '@/application/database-yjs/relation/cache';
import {
  invalidateRollupCell,
  readRollupCell,
  readRollupCellSync,
  subscribeRollupCell,
} from '@/application/database-yjs/rollup/cache';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createTextField(fieldId: string, name: string, isPrimary = false): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  if (isPrimary) {
    field.set(YjsDatabaseKey.is_primary, true);
  }
  return field;
}

function createNumberField(fieldId: string, name: string): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.Number);
  return field;
}

function createDatabaseDoc(databaseId: string, viewId: string, fields: YDatabaseFields): YDoc {
  const doc = new Y.Doc() as YDoc;
  doc.guid = viewId;
  doc.object_id = viewId;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function createCell(data: unknown, fieldType: FieldType): YDatabaseCell {
  const cell = new Y.Map() as YDatabaseCell;
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, fieldType);
  return cell;
}

function createRowDoc(rowId: string, databaseId: string, cellMap: Record<string, YDatabaseCell>): YDoc {
  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;

  Object.entries(cellMap).forEach(([fieldId, cell]) => {
    cells.set(fieldId, cell);
  });

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.cells, cells);
  row.set(YjsDatabaseKey.created_at, '0');
  row.set(YjsDatabaseKey.last_modified, '0');
  sharedRoot.set(YjsEditorKey.database_row, row);
  return doc;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function createFixture({
  suffix,
  rollups = [],
}: {
  suffix: string;
  rollups?: Array<{
    fieldId: string;
    targetFieldId: string;
    calculationType: CalculationType;
    showAs: RollupDisplayMode;
  }>;
}) {
  const relatedDatabaseId = `related-db-${suffix}`;
  const relatedViewId = `related-view-${suffix}`;
  const baseDatabaseId = `base-db-${suffix}`;
  const baseViewId = `base-view-${suffix}`;

  const relationFieldId = `relation-${suffix}`;
  const primaryFieldId = `name-${suffix}`;
  const scoreFieldId = `score-${suffix}`;
  const baseRowId = `base-row-${suffix}`;
  const relatedRowIds = [`rel-row-1-${suffix}`, `rel-row-2-${suffix}`];

  const relatedFields = new Y.Map() as YDatabaseFields;
  relatedFields.set(primaryFieldId, createTextField(primaryFieldId, 'Name', true));
  relatedFields.set(scoreFieldId, createNumberField(scoreFieldId, 'Score'));
  const relatedDoc = createDatabaseDoc(relatedDatabaseId, relatedViewId, relatedFields);

  const relatedRowDocs = new Map<string, YDoc>();
  const relatedRows = [
    { id: relatedRowIds[0], name: 'Alice', score: '10' },
    { id: relatedRowIds[1], name: 'Bob', score: '20' },
  ];
  relatedRows.forEach((row) => {
    const rowDoc = createRowDoc(row.id, relatedDatabaseId, {
      [primaryFieldId]: createCell(row.name, FieldType.RichText),
      [scoreFieldId]: createCell(row.score, FieldType.Number),
    });
    relatedRowDocs.set(row.id, rowDoc);
  });

  const relationField = createRelationField(relationFieldId);
  relationField.set(YjsDatabaseKey.name, 'Authors');

  const baseFields = new Y.Map() as YDatabaseFields;
  baseFields.set(`title-${suffix}`, createTextField(`title-${suffix}`, 'Title', true));
  baseFields.set(relationFieldId, relationField);

  rollups.forEach((rollupConfig) => {
    const rollupField = createRollupField(rollupConfig.fieldId);
    baseFields.set(rollupConfig.fieldId, rollupField);
  });

  const baseDoc = createDatabaseDoc(baseDatabaseId, baseViewId, baseFields);
  const relationIds = new Y.Array<string>();
  relationIds.push(relatedRowIds);

  const baseRowDoc = createRowDoc(baseRowId, baseDatabaseId, {
    [relationFieldId]: createCell(relationIds, FieldType.Relation),
  });
  const baseRow = baseRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  const createRow = async (rowKey: string) => {
    const rowId = rowKey.includes('_rows_') ? rowKey.split('_rows_').pop() ?? '' : rowKey;
    return relatedRowDocs.get(rowId) ?? null;
  };
  const loadView = async (viewId: string) => (viewId === relatedViewId ? relatedDoc : null);
  const getViewIdFromDatabaseId = async (databaseId: string) =>
    databaseId === relatedDatabaseId ? relatedViewId : null;

  const baseDatabase = baseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  const integratedRelationField = baseDatabase.get(YjsDatabaseKey.fields)?.get(relationFieldId) as
    | YDatabaseField
    | undefined;
  const integratedRelationOption = integratedRelationField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Relation));
  integratedRelationOption?.set(YjsDatabaseKey.database_id, relatedDatabaseId);

  rollups.forEach((rollupConfig) => {
    const rollupField = baseDatabase.get(YjsDatabaseKey.fields)?.get(rollupConfig.fieldId) as YDatabaseField | undefined;
    const rollupOption = rollupField?.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Rollup));
    rollupOption?.set(YjsDatabaseKey.relation_field_id, relationFieldId);
    rollupOption?.set(YjsDatabaseKey.target_field_id, rollupConfig.targetFieldId);
    rollupOption?.set(YjsDatabaseKey.calculation_type, rollupConfig.calculationType);
    rollupOption?.set(YjsDatabaseKey.show_as, rollupConfig.showAs);
  });

  return {
    baseDoc,
    baseDatabase,
    baseRow,
    baseRowId,
    relationField,
    relationFieldId,
    primaryFieldId,
    scoreFieldId,
    relatedDatabaseId,
    relatedViewId,
    relatedRowIds,
    createRow,
    loadView,
    getViewIdFromDatabaseId,
  };
}

describe('relation and rollup basics', () => {
  it('observes a group-label resolution that emits between render and subscription', async () => {
    const fixture = createFixture({ suffix: 'group-label-external-store' });
    const context = {
      relationField: fixture.relationField,
      relatedRowId: fixture.relatedRowIds[0],
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };
    const initialRevision = getRelationGroupLabelRevision();
    const { result } = renderHook(() => {
      const revision = useSyncExternalStore(
        subscribeRelationGroupLabels,
        getRelationGroupLabelRevision,
        getRelationGroupLabelRevision
      );

      // Reading stays pure; the lookup runs after commit, matching how
      // useDatabaseGroupingSelector drives it.
      useEffect(() => {
        ensureRelationGroupLabel(context);
      });

      return { label: readRelationGroupLabel(context), revision };
    });

    expect(result.current.label).toBe('');
    await waitFor(() => expect(result.current.label).toBe('Alice'));
    expect(result.current.revision).toBeGreaterThan(initialRevision);
  });

  it('refreshes an empty group label when its cold row document hydrates', async () => {
    const fixture = createFixture({ suffix: 'group-label-cold-hydration' });
    const coldRowDoc = new Y.Doc() as YDoc;
    const createRow = jest.fn(async () => coldRowDoc);
    const context = {
      relationField: fixture.relationField,
      relatedRowId: fixture.relatedRowIds[0],
      loadView: fixture.loadView,
      createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };
    const initialRevision = getRelationGroupLabelRevision();
    const { result } = renderHook(() => {
      const revision = useSyncExternalStore(
        subscribeRelationGroupLabels,
        getRelationGroupLabelRevision,
        getRelationGroupLabelRevision
      );

      useEffect(() => {
        ensureRelationGroupLabel(context);
      });

      return { label: readRelationGroupLabel(context), revision };
    });

    await waitFor(() => {
      expect(createRow).toHaveBeenCalledTimes(1);
      expect(result.current.revision).toBeGreaterThan(initialRevision);
    });
    expect(result.current.label).toBe('');

    const hydratedRowDoc = createRowDoc(fixture.relatedRowIds[0], fixture.relatedDatabaseId, {
      [fixture.primaryFieldId]: createCell('Alice', FieldType.RichText),
    });

    act(() => {
      Y.applyUpdate(coldRowDoc, Y.encodeStateAsUpdate(hydratedRowDoc));
    });

    await waitFor(() => expect(result.current.label).toBe('Alice'));
    expect(createRow).toHaveBeenCalledTimes(2);
  });

  it('keeps serving a resolved group label after its cache entry goes stale', async () => {
    const fixture = createFixture({ suffix: 'group-label-ttl' });
    const context = {
      relationField: fixture.relationField,
      relatedRowId: fixture.relatedRowIds[0],
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };
    const resolved = new Promise<string>((resolve) => {
      const unsubscribe = subscribeRelationGroupLabels(() => {
        const value = readRelationGroupLabel(context);

        if (!value) return;
        unsubscribe();
        resolve(value);
      });
    });

    ensureRelationGroupLabel(context);
    await expect(resolved).resolves.toBe('Alice');

    const realNow = Date.now;
    const base = realNow();

    // Well past both the 5s entry TTL and the 2s prune interval, with no edit
    // to the related row. A header must never fall back to its placeholder
    // just because the entry is due for revalidation.
    Date.now = () => base + 60_000;
    try {
      ensureRelationGroupLabel(context);
      expect(readRelationGroupLabel(context)).toBe('Alice');
    } finally {
      Date.now = realNow;
    }
  });

  it('resolves a relation group identifier to the related primary title', async () => {
    const fixture = createFixture({ suffix: 'group-label' });
    const context = {
      relationField: fixture.relationField,
      relatedRowId: fixture.relatedRowIds[0],
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };

    const resultPromise = new Promise<string>((resolve) => {
      const unsubscribe = subscribeRelationGroupLabels(() => {
        const value = readRelationGroupLabel(context);

        if (!value) return;
        unsubscribe();
        resolve(value);
      });
    });

    expect(readRelationGroupLabel(context)).toBe('');
    ensureRelationGroupLabel(context);
    await expect(resultPromise).resolves.toBe('Alice');
  });

  it('keeps every active group label cached when a grouping exceeds the soft limit', async () => {
    const fixture = createFixture({ suffix: 'group-label-active-cache' });
    const sharedRowDoc = createRowDoc('shared-active-row', fixture.relatedDatabaseId, {
      [fixture.primaryFieldId]: createCell('Alice', FieldType.RichText),
    });
    const createRow = jest.fn(async () => sharedRowDoc);
    const contexts = Array.from({ length: 501 }, (_, index) => ({
      relationField: fixture.relationField,
      relatedRowId: `active-row-${index}`,
      loadView: fixture.loadView,
      createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    }));
    const release = retainRelationGroupLabels(contexts);

    try {
      contexts.forEach(ensureRelationGroupLabel);

      await waitFor(
        () => {
          expect(contexts.every((context) => readRelationGroupLabel(context) === 'Alice')).toBe(true);
        },
        { timeout: 3_000 }
      );
      expect(createRow).toHaveBeenCalledTimes(contexts.length);

      contexts.forEach(ensureRelationGroupLabel);
      await Promise.resolve();
      expect(createRow).toHaveBeenCalledTimes(contexts.length);
    } finally {
      release();
    }
  });

  it('does not wake group-label subscribers when a relation cell resolves', async () => {
    const fixture = createFixture({ suffix: 'group-label-channel' });
    const cellContext = {
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      relationField: fixture.relationField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: fixture.relationFieldId,
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };
    const groupLabelWakeups = jest.fn();
    const unsubscribe = subscribeRelationGroupLabels(groupLabelWakeups);
    const cellResolved = new Promise<string>((resolve) => {
      const unsubscribeCells = subscribeRelationCache(() => {
        const value = readRelationCellText(cellContext);

        if (!value) return;
        unsubscribeCells();
        resolve(value);
      });
    });

    readRelationCellText(cellContext);
    await expect(cellResolved).resolves.toContain('Alice');

    unsubscribe();
    expect(groupLabelWakeups).not.toHaveBeenCalled();
  });

  it('refreshes a relation group label when the related primary cell changes', async () => {
    const fixture = createFixture({ suffix: 'live-group-label' });
    const relatedRowId = fixture.relatedRowIds[0];
    const context = {
      relationField: fixture.relationField,
      relatedRowId,
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };
    const initial = new Promise<string>((resolve) => {
      const unsubscribe = subscribeRelationGroupLabels(() => {
        const value = readRelationGroupLabel(context);

        if (!value) return;
        unsubscribe();
        resolve(value);
      });
    });

    ensureRelationGroupLabel(context);
    await expect(initial).resolves.toBe('Alice');

    const updated = new Promise<string>((resolve) => {
      const unsubscribe = subscribeRelationGroupLabels(() => {
        // A revision bump is what sends the consumer back through its effect,
        // so re-requesting here mirrors useDatabaseGroupingSelector.
        ensureRelationGroupLabel(context);
        const value = readRelationGroupLabel(context);

        if (value !== 'Alicia') return;
        unsubscribe();
        resolve(value);
      });
    });
    const relatedRowDoc = await fixture.createRow(`${fixture.relatedViewId}_rows_${relatedRowId}`);
    const relatedRow = relatedRowDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    relatedRow.get(YjsDatabaseKey.cells).get(fixture.primaryFieldId)?.set(YjsDatabaseKey.data, 'Alicia');

    await expect(updated).resolves.toBe('Alicia');
  });

  it('does not let stale in-flight label work overwrite a newer related title', async () => {
    const fixture = createFixture({ suffix: 'group-label-race' });
    const relatedRowId = fixture.relatedRowIds[0];
    const canonicalRowDoc = await fixture.createRow(`${fixture.relatedViewId}_rows_${relatedRowId}`);
    const staleRowDoc = createRowDoc(relatedRowId, fixture.relatedDatabaseId, {
      [fixture.primaryFieldId]: createCell('Alice', FieldType.RichText),
    });
    let createRowCall = 0;
    let releaseStaleLookup: ((rowDoc: YDoc) => void) | undefined;
    let markStaleLookupStarted: (() => void) | undefined;
    const staleLookupStarted = new Promise<void>((resolve) => {
      markStaleLookupStarted = resolve;
    });
    const staleLookup = new Promise<YDoc>((resolve) => {
      releaseStaleLookup = resolve;
    });
    const context = {
      relationField: fixture.relationField,
      relatedRowId,
      loadView: fixture.loadView,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      createRow: async () => {
        createRowCall += 1;

        if (createRowCall === 2) {
          markStaleLookupStarted?.();
          return staleLookup;
        }

        return canonicalRowDoc as YDoc;
      },
    };
    const waitForLabel = (expected: string) =>
      new Promise<string>((resolve) => {
        const unsubscribe = subscribeRelationGroupLabels(() => {
          ensureRelationGroupLabel(context);
          const value = readRelationGroupLabel(context);

          if (value !== expected) return;
          unsubscribe();
          resolve(value);
        });

        ensureRelationGroupLabel(context);
      });

    await expect(waitForLabel('Alice')).resolves.toBe('Alice');

    const canonicalPrimaryCell = canonicalRowDoc
      ?.getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row)
      ?.get(YjsDatabaseKey.cells)
      .get(fixture.primaryFieldId);

    canonicalPrimaryCell?.set(YjsDatabaseKey.data, 'Alicia');
    ensureRelationGroupLabel(context);
    await staleLookupStarted;

    canonicalPrimaryCell?.set(YjsDatabaseKey.data, 'Beatrice');
    const newestLabel = waitForLabel('Beatrice');

    await expect(newestLabel).resolves.toBe('Beatrice');
    releaseStaleLookup?.(staleRowDoc);
    await Promise.resolve();
    await Promise.resolve();

    expect(readRelationGroupLabel(context)).toBe('Beatrice');
  });

  it('resolves relation cell text from related primary field values', async () => {
    const fixture = createFixture({ suffix: 'relation' });
    const relationOption = parseRelationTypeOption(fixture.relationField);
    expect(relationOption?.database_id).toBe(fixture.relatedDatabaseId);
    const relationCell = fixture.baseRow.get(YjsDatabaseKey.cells)?.get(fixture.relationFieldId);
    const relationData = relationCell?.get(YjsDatabaseKey.data);
    expect(
      relationData && typeof relationData === 'object' && 'toJSON' in relationData
        ? (relationData as { toJSON: () => unknown }).toJSON()
        : []
    ).toEqual(fixture.relatedRowIds);
    const rowKey = `${fixture.relatedViewId}_rows_${fixture.relatedRowIds[0]}`;
    const relatedRowDoc = await fixture.createRow(rowKey);
    expect(relatedRowDoc).not.toBeNull();
    const context = {
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      relationField: fixture.relationField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: fixture.relationFieldId,
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };

    const resultPromise = new Promise<string>((resolve) => {
      const unsubscribe = subscribeRelationCache(() => {
        const value = readRelationCellText(context);
        unsubscribe();
        resolve(value);
      });
    });

    readRelationCellText(context);
    const value = await resultPromise;

    expect(value).toBe('Alice, Bob');
  });

  it('computes rollup sum for numeric target fields', async () => {
    const rollupFieldId = 'rollup-sum';
    const suffix = 'rollup-sum';
    const fixture = createFixture({
      suffix,
      rollups: [
        {
          fieldId: rollupFieldId,
          targetFieldId: `score-${suffix}`,
          calculationType: CalculationType.Sum,
          showAs: RollupDisplayMode.Calculated,
        },
      ],
    });

    const cellId = `${fixture.baseRowId}:${rollupFieldId}`;
    const resultPromise = new Promise<ReturnType<typeof readRollupCellSync>>((resolve) => {
      const unsubscribe = subscribeRollupCell(cellId, (value) => {
        unsubscribe();
        resolve(value);
      });
    });

    readRollupCellSync({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: fixture.baseDatabase.get(YjsDatabaseKey.fields).get(rollupFieldId) as YDatabaseField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    const value = await resultPromise;
    expect(value.value).toBe('30');
    expect(value.rawNumeric).toBe(30);
  });

  it('keeps a replacement computation registered when an invalidated computation finishes', async () => {
    const rollupFieldId = 'rollup-inflight-owner';
    const fixture = createFixture({
      suffix: 'rollup-inflight-owner',
      rollups: [
        {
          fieldId: rollupFieldId,
          targetFieldId: 'name-rollup-inflight-owner',
          calculationType: CalculationType.CountNonEmpty,
          showAs: RollupDisplayMode.Calculated,
        },
      ],
    });
    const relationIds = new Y.Array<string>();

    relationIds.push([fixture.relatedRowIds[0]]);
    fixture.baseRow.get(YjsDatabaseKey.cells).get(fixture.relationFieldId)?.set(YjsDatabaseKey.data, relationIds);

    const gates: Array<ReturnType<typeof createDeferred<void>>> = [];
    const createRow = jest.fn((rowKey: string) => {
      const gate = createDeferred<void>();

      gates.push(gate);
      return gate.promise.then(() => fixture.createRow(rowKey));
    });
    const context = {
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: fixture.baseDatabase.get(YjsDatabaseKey.fields).get(rollupFieldId) as YDatabaseField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };
    const cellId = `${fixture.baseRowId}:${rollupFieldId}`;
    const firstRead = readRollupCell(context);

    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(1));
    invalidateRollupCell(cellId);
    const replacementRead = readRollupCell(context);

    await waitFor(() => expect(createRow).toHaveBeenCalledTimes(2));
    gates[0].resolve();
    await firstRead;

    const joinedRead = readRollupCell(context);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createRow).toHaveBeenCalledTimes(2);

    gates[1].resolve();
    await expect(replacementRead).resolves.toMatchObject({ value: '1' });
    await expect(joinedRead).resolves.toMatchObject({ value: '1' });
  });

  it('returns rollup original list values when configured', async () => {
    const rollupFieldId = 'rollup-list';
    const suffix = 'rollup-list';
    const fixture = createFixture({
      suffix,
      rollups: [
        {
          fieldId: rollupFieldId,
          targetFieldId: `name-${suffix}`,
          calculationType: CalculationType.Count,
          showAs: RollupDisplayMode.OriginalList,
        },
      ],
    });

    const cellId = `${fixture.baseRowId}:${rollupFieldId}`;
    const resultPromise = new Promise<ReturnType<typeof readRollupCellSync>>((resolve) => {
      const unsubscribe = subscribeRollupCell(cellId, (value) => {
        unsubscribe();
        resolve(value);
      });
    });

    readRollupCellSync({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: fixture.baseDatabase.get(YjsDatabaseKey.fields).get(rollupFieldId) as YDatabaseField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRow: fixture.createRow,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    const value = await resultPromise;
    expect(value.value).toBe('Alice, Bob');
    expect(value.list).toEqual(['Alice', 'Bob']);
  });
});
