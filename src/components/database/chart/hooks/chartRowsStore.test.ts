import * as Y from 'yjs';
import type { YEvent } from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { ChartRowsWatch, createChartRowsStore, yjsEventTouchesChartRow } from './chartRowsStore';

const event = (path: Array<string | number>, keysChanged: string[] = []) =>
  ({ path, keysChanged: new Set(keysChanged) }) as unknown as YEvent;
const watch = (fieldIds: string[], rowKeys: string[] = []): ChartRowsWatch => ({
  fieldIds: new Set(fieldIds),
  rowKeys: new Set(rowKeys),
});
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const rowDoc = (id: string, status: string) =>
  createRowDoc(id, 'chart-database', {
    status: createCell(FieldType.SingleSelect, status),
    amount: createCell(FieldType.Number, '1'),
  });
const cellOf = (doc: YDoc, fieldId: string) =>
  (doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow)
    .get(YjsDatabaseKey.cells)
    .get(fieldId);

describe('yjsEventTouchesChartRow', () => {
  const chart = watch(['status'], [YjsDatabaseKey.last_modified]);
  const ROW = YjsEditorKey.database_row;
  const CELLS = YjsDatabaseKey.cells;

  it.each([
    ['the row data arriving in an empty document', event([], [ROW])],
    ['the cells map being replaced', event([ROW], [CELLS])],
    ['a watched row key', event([ROW], [YjsDatabaseKey.height, YjsDatabaseKey.last_modified])],
    ['a watched cell being set', event([ROW, CELLS], ['status'])],
    ['a watched cell being edited', event([ROW, CELLS, 'status'], [YjsDatabaseKey.data])],
    ["a watched cell's nested text being edited", event([ROW, CELLS, 'status', YjsDatabaseKey.data])],
  ])('accepts %s', (_, candidate) => {
    expect(yjsEventTouchesChartRow(candidate, chart)).toBe(true);
  });

  it.each([
    ['another root key', event([], [YjsEditorKey.meta])],
    ['row keys the axes do not read', event([ROW], [YjsDatabaseKey.created_at, YjsDatabaseKey.height])],
    ['another cell being set', event([ROW, CELLS], ['amount'])],
    ['another cell being edited', event([ROW, CELLS, 'amount'], [YjsDatabaseKey.data])],
    ['the row meta', event([YjsEditorKey.meta], ['icon'])],
  ])('ignores %s', (_, candidate) => {
    expect(yjsEventTouchesChartRow(candidate, chart)).toBe(false);
  });
});

describe('createChartRowsStore', () => {
  it('publishes one revision per frame for a burst of watched edits', async () => {
    const store = createChartRowsStore(watch(['status']));
    const listener = jest.fn();
    const r1 = rowDoc('r1', 'a');
    const r2 = rowDoc('r2', 'b');

    store.subscribe(listener);
    store.replaceRows({ r1, r2 });
    cellOf(r1, 'status').set(YjsDatabaseKey.data, 'b');
    cellOf(r2, 'status').set(YjsDatabaseKey.data, 'a');
    cellOf(r1, 'status').set(YjsDatabaseKey.data, 'c');

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(0);
    await nextFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(1);
  });

  it('ignores edits outside the watch and follows setWatch without re-attaching', async () => {
    const store = createChartRowsStore(watch(['status']));
    const r1 = rowDoc('r1', 'a');
    const observeDeep = jest.spyOn(r1.getMap(YjsEditorKey.data_section), 'observeDeep');

    store.replaceRows({ r1 });
    cellOf(r1, 'amount').set(YjsDatabaseKey.data, '2');
    await nextFrame();
    expect(store.getSnapshot()).toBe(0);

    store.setWatch(watch(['amount']));
    cellOf(r1, 'amount').set(YjsDatabaseKey.data, '3');
    await nextFrame();
    expect(store.getSnapshot()).toBe(1);
    expect(observeDeep).toHaveBeenCalledTimes(1);
  });

  it('re-attaches only the docs whose instance changed and drops removed ones', async () => {
    const store = createChartRowsStore(watch(['status']));
    const r1 = rowDoc('r1', 'a');
    const r2 = rowDoc('r2', 'a');
    const r2Replacement = rowDoc('r2', 'b');
    const [observeR1, observeR2, observeReplacement] = [r1, r2, r2Replacement].map((doc) =>
      jest.spyOn(doc.getMap(YjsEditorKey.data_section), 'observeDeep')
    );

    store.replaceRows({ r1, r2 });
    store.replaceRows({ r1, r2 });
    expect(observeR1).toHaveBeenCalledTimes(1);
    expect(observeR2).toHaveBeenCalledTimes(1);

    store.replaceRows({ r1, r2: r2Replacement });
    expect(observeR1).toHaveBeenCalledTimes(1);
    expect(observeReplacement).toHaveBeenCalledTimes(1);

    cellOf(r2, 'status').set(YjsDatabaseKey.data, 'x');
    await nextFrame();
    expect(store.getSnapshot()).toBe(0);
    cellOf(r2Replacement, 'status').set(YjsDatabaseKey.data, 'x');
    await nextFrame();
    expect(store.getSnapshot()).toBe(1);

    store.replaceRows({ r2: r2Replacement });
    cellOf(r1, 'status').set(YjsDatabaseKey.data, 'y');
    await nextFrame();
    expect(store.getSnapshot()).toBe(1);
  });

  it('detachRows drops the observers and a pending publish, and the store can be reused', async () => {
    const store = createChartRowsStore(watch(['status']));
    const r1 = rowDoc('r1', 'a');

    store.replaceRows({ r1 });
    cellOf(r1, 'status').set(YjsDatabaseKey.data, 'b');
    store.detachRows();
    await nextFrame();
    expect(store.getSnapshot()).toBe(0);

    cellOf(r1, 'status').set(YjsDatabaseKey.data, 'c');
    await nextFrame();
    expect(store.getSnapshot()).toBe(0);

    store.replaceRows({ r1 });
    cellOf(r1, 'status').set(YjsDatabaseKey.data, 'd');
    await nextFrame();
    expect(store.getSnapshot()).toBe(1);
  });

  it('survives a row document destroyed before it is detached', () => {
    const store = createChartRowsStore(watch(['status']));
    const r1 = rowDoc('r1', 'a');

    store.replaceRows({ r1 });
    r1.destroy();

    expect(() => store.detachRows()).not.toThrow();
  });

  it('publishes when a sync fills a row document that opened empty', async () => {
    const store = createChartRowsStore(watch(['status']));
    const empty = new Y.Doc() as YDoc;

    store.replaceRows({ r1: empty });
    Y.applyUpdate(empty, Y.encodeStateAsUpdate(rowDoc('r1', 'a')));
    await nextFrame();

    expect(store.getSnapshot()).toBe(1);
  });
});
