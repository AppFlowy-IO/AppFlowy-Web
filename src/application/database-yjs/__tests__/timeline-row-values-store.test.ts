import * as Y from 'yjs';

import { getCell } from '@/application/database-yjs/const';
import { FieldType } from '@/application/database-yjs/database.type';
import { createTimelineRowValuesStore } from '@/application/database-yjs/timeline-row-values-store';
import { YDoc, YjsDatabaseKey } from '@/application/types';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

// Exercise the real scheduler instead of the global synchronous debounce mock.
jest.mock('lodash-es', () => jest.requireActual('lodash'));

function row(id: string, value: string) {
  return createRowDoc(id, 'database', { progress: { fieldType: FieldType.Number, data: value } });
}

function setValue(doc: YDoc, id: string, value: string, local = true) {
  if (local) {
    getCell(id, 'progress', { [id]: doc }).set(YjsDatabaseKey.data, value);
    return;
  }

  const remote = new Y.Doc() as YDoc;

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  getCell(id, 'progress', { [id]: remote }).set(YjsDatabaseKey.data, value);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
  remote.destroy();
}

describe('incremental timeline row values', () => {
  afterEach(() => jest.useRealTimers());

  it.each([true, false])('publishes one snapshot for a 1,000-row update burst (local: %s)', (local) => {
    jest.useFakeTimers();
    const docs = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [String(index), row(String(index), '10')])
    );
    const parse = jest.fn((id: string, doc: YDoc) => getCell(id, 'progress', { [id]: doc })?.get(YjsDatabaseKey.data));
    const store = createTimelineRowValuesStore(parse);

    store.syncRows(Object.keys(docs), docs);
    const before = store.getSnapshot();
    const notify = jest.fn();

    store.subscribe(notify);
    parse.mockClear();
    for (let index = 0; index < 1000; index += 1) {
      const id = String(index);

      setValue(docs[id], id, '20', local);
    }

    expect(notify).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    if (local) {
      jest.runAllTicks();
    } else {
      jest.advanceTimersByTime(151);
    }

    expect(notify).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1000);
    expect([...store.getSnapshot().values.values()].filter((value) => value === '20')).toHaveLength(1000);
    expect(store.getSnapshot().values.get('1000')).toBe('10');
    expect(before.values.get('0')).toBe('10');
    expect(store.getSnapshot().complete).toBe(true);
    store.dispose();
    Object.values(docs).forEach((doc) => doc.destroy());
  });

  it('distinguishes incomplete membership from complete rows with empty cells or no filtered results', () => {
    const doc = row('a', '10');
    const blank = createRowDoc('blank', 'database', {});
    const store = createTimelineRowValuesStore((id, source) =>
      getCell(id, 'progress', { [id]: source })?.get(YjsDatabaseKey.data)
    );

    store.syncRows(undefined, {});
    expect(store.getSnapshot().complete).toBe(false);
    store.syncRows(['a', 'blank'], { a: doc });
    expect(store.getSnapshot().complete).toBe(false);
    expect(store.getSnapshot().values.get('a')).toBe('10');
    store.applyCachedRowsChange({ added: { blank }, removed: {} });
    expect(store.getSnapshot().complete).toBe(true);
    expect(store.getSnapshot().values.size).toBe(1);
    store.syncRows(['a', 'blank', 'pending'], { a: doc });
    expect(store.getSnapshot().complete).toBe(false);
    expect(store.getSnapshot().values.get('a')).toBe('10');
    store.syncRows(['a', 'blank'], { a: doc });
    expect(store.getSnapshot().complete).toBe(true);
    store.syncRows([], { a: doc });
    expect(store.getSnapshot()).toEqual({ values: new Map(), complete: true });
    store.syncRows(undefined, { a: doc });
    expect(store.getSnapshot().complete).toBe(false);
    store.dispose();
    doc.destroy();
    blank.destroy();
  });

  it('cancels pending updates on cleanup and restores subscriptions on effect replay', () => {
    jest.useFakeTimers();
    const live = row('a', '10');
    const seed = row('b', '20');
    const store = createTimelineRowValuesStore((id, doc) =>
      getCell(id, 'progress', { [id]: doc })?.get(YjsDatabaseKey.data)
    );

    store.syncRows(['a', 'b'], { a: live });
    store.applyCachedRowsChange({ added: { b: seed }, removed: {} });
    const notify = jest.fn();

    store.subscribe(notify);
    getCell('a', 'progress', { a: live }).set(YjsDatabaseKey.data, '30');
    setValue(seed, 'b', '40', false);
    store.dispose();
    jest.runAllTimers();
    expect(notify).not.toHaveBeenCalled();
    store.syncRows(['a', 'b'], { a: live });
    store.applyCachedRowsChange({ added: { b: seed }, removed: {} });
    expect(store.getSnapshot()).toEqual({
      values: new Map([
        ['a', '30'],
        ['b', '40'],
      ]),
      complete: true,
    });
    notify.mockClear();
    getCell('a', 'progress', { a: live }).set(YjsDatabaseKey.data, '50');
    jest.runAllTimers();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().values.get('a')).toBe('50');
    store.dispose();
    live.destroy();
    seed.destroy();
  });

  it('decodes each added document once and keeps pending live updates during seed eviction', () => {
    jest.useFakeTimers();
    const parse = jest.fn((id: string, doc: YDoc) => getCell(id, 'progress', { [id]: doc })?.get(YjsDatabaseKey.data));
    const store = createTimelineRowValuesStore(parse);
    const seeds = { a: row('a', '10'), b: row('b', '20'), c: row('c', '30') };

    store.syncRows(['a', 'b', 'c'], {});
    store.applyCachedRowsChange({ added: { a: seeds.a, b: seeds.b }, removed: {} });
    store.applyCachedRowsChange({ added: { c: seeds.c }, removed: {} });
    expect(parse).toHaveBeenCalledTimes(3);
    expect([...store.getSnapshot().values.values()]).toEqual(['10', '20', '30']);
    const live = row('a', '40');

    store.syncRows(['a', 'b', 'c'], { a: live });
    expect(parse).toHaveBeenCalledTimes(4);
    setValue(live, 'a', '50', false);
    store.applyCachedRowsChange({ added: {}, removed: { a: seeds.a } });
    jest.advanceTimersByTime(151);
    expect(store.getSnapshot().values.get('a')).toBe('50');
    expect(parse).toHaveBeenCalledTimes(5);
    // An old seed update can never replace the active row's value.
    getCell('a', 'progress', seeds).set(YjsDatabaseKey.data, '0');
    jest.runAllTimers();
    expect(store.getSnapshot().values.get('a')).toBe('50');
    expect(parse).toHaveBeenCalledTimes(5);
    store.dispose();
    Object.values(seeds).forEach((doc) => doc.destroy());
    live.destroy();
  });
});
