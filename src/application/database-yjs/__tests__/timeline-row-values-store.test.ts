import * as Y from 'yjs';

import { getCell } from '@/application/database-yjs/const';
import { FieldType } from '@/application/database-yjs/database.type';
import { createTimelineRowValuesStore } from '@/application/database-yjs/hooks/useTimelineRowValues';
import { YDoc, YjsDatabaseKey } from '@/application/types';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function row(id: string, value: string) {
  return createRowDoc(id, 'database', { progress: { fieldType: FieldType.Number, data: value } });
}

describe('incremental timeline row values', () => {
  it('decodes each added document once and keeps pending live updates during seed eviction', () => {
    jest.useFakeTimers();
    const parse = jest.fn((id: string, doc: YDoc) => getCell(id, 'progress', { [id]: doc })?.get(YjsDatabaseKey.data));
    const store = createTimelineRowValuesStore(parse);
    const seeds = { a: row('a', '10'), b: row('b', '20'), c: row('c', '30') };

    store.syncRows(['a', 'b', 'c'], {});
    store.applyCachedRowsChange({ added: { a: seeds.a, b: seeds.b }, removed: {} });
    store.applyCachedRowsChange({ added: { c: seeds.c }, removed: {} });
    expect(parse).toHaveBeenCalledTimes(3);
    expect([...store.getSnapshot().values()]).toEqual(['10', '20', '30']);
    const live = row('a', '40');

    store.syncRows(['a', 'b', 'c'], { a: live });
    expect(parse).toHaveBeenCalledTimes(4);
    Y.transact(live, () => getCell('a', 'progress', { a: live }).set(YjsDatabaseKey.data, '50'), null, false);
    store.applyCachedRowsChange({ added: {}, removed: { a: seeds.a } });
    jest.advanceTimersByTime(151);
    expect(store.getSnapshot().get('a')).toBe('50');
    expect(parse).toHaveBeenCalledTimes(5);
    // An old seed update can never replace the active row's value.
    getCell('a', 'progress', seeds).set(YjsDatabaseKey.data, '0');
    jest.runAllTimers();
    expect(store.getSnapshot().get('a')).toBe('50');
    expect(parse).toHaveBeenCalledTimes(5);
    store.dispose();
    Object.values(seeds).forEach((doc) => doc.destroy());
    live.destroy();
    jest.useRealTimers();
  });
});
