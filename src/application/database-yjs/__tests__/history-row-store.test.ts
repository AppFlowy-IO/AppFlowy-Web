import * as Y from 'yjs';

import { DatabaseHistoryRowStore, retainDatabaseHistoryRow } from '../history-row-store';
import { isDatabaseHistoryDocumentImmutable } from '../immutable';

function encodedRow(value: number, encoder = 1) {
  const doc = new Y.Doc();

  doc.getMap('row').set('value', value);
  const bytes = encoder === 2 ? Y.encodeStateAsUpdateV2(doc) : Y.encodeStateAsUpdate(doc);

  doc.destroy();
  return bytes;
}

test('scans every saved row with a bounded hydrated working set', () => {
  const store = new DatabaseHistoryRowStore('history:test');

  for (let i = 0; i < 400; i++) store.add(String(i), encodedRow(i, i % 2 + 1), i % 2 + 1);
  expect(Object.keys(store.rows)).toHaveLength(400);
  expect(store.cachedDocumentCount).toBe(0);
  let sum = 0;

  for (const id of Object.keys(store.rows)) {
    const row = store.rows[id];

    sum += Number(row.getMap('row').get('value'));
    expect(isDatabaseHistoryDocumentImmutable(row)).toBe(true);
    expect(store.cachedDocumentCount).toBeLessThanOrEqual(128);
  }

  expect(sum).toBe(79800);
  expect(store.rows['missing']).toBeUndefined();
  store.destroy();
  expect(Object.keys(store.rows)).toEqual([]);
  expect(store.rows['0']).toBeUndefined();
});

test('pins shared mounted readers across scans and destroys them only when their session closes', () => {
  const store = new DatabaseHistoryRowStore('history:mounted');

  for (let i = 0; i < 300; i++) store.add(String(i), encodedRow(i), 1);
  const selected = store.rows['0'];
  const destroyed = jest.fn();

  selected.on('destroy', destroyed);
  const releaseCell = retainDatabaseHistoryRow(store.rows, selected);
  const releaseInspector = retainDatabaseHistoryRow(store.rows, selected);

  for (let i = 1; i < 300; i++) void store.rows[String(i)];
  expect(store.rows['0']).toBe(selected);
  releaseCell();
  releaseCell();
  for (let i = 1; i < 300; i++) void store.rows[String(i)];
  expect(store.rows['0']).toBe(selected);
  expect(destroyed).not.toHaveBeenCalled();
  store.destroy();
  expect(destroyed).toHaveBeenCalledTimes(1);
  releaseInspector();
  store.destroy();
  expect(destroyed).toHaveBeenCalledTimes(1);
});

test('validates offscreen rows before readiness and owns copies of encoded bytes', () => {
  const store = new DatabaseHistoryRowStore('history:validation');
  const bytes = encodedRow(42);

  store.add('row', bytes, 1);
  bytes.fill(0);
  expect(store.rows.row.getMap('row').get('value')).toBe(42);
  expect(() => store.add('row', encodedRow(2), 1)).toThrow('duplicate');
  expect(() => store.add('other', new Uint8Array([255]), 1)).toThrow();
  expect(() => store.add('other', encodedRow(2), 3)).toThrow('unsupported');
  expect(store.rowCount).toBe(1);
  store.destroy();
});
