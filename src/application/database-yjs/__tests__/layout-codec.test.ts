import * as Y from 'yjs';

import {
  clampInteger,
  cloneYValue,
  isPlainRecord,
  nonEmptyString,
  pickUnknownKeys,
  readBoolean,
  readInteger,
  readNumber,
  readStringEnum,
  readStringList,
  sameLayoutValue,
  setLayoutKeyIfChanged,
  toPlainValue,
} from '@/application/database-yjs/layout-codec';

import { setParityValue } from './dashboard-parity-helpers';

function recordingMap(entries: Record<string, unknown>) {
  const map = new Map(Object.entries(entries));
  const set = jest.fn((key: string, value: unknown) => map.set(key, value));

  return { get: (key: string) => map.get(key), set, map };
}

describe('layout codec', () => {
  it('clones a stored Y value Yjs can insert again: detached, bigints as numbers, the source untouched', () => {
    const doc = new Y.Doc();
    const source = new Y.Map<unknown>();
    const list = new Y.Array<unknown>();

    doc.getMap('root').set('source', source);
    source.set('condition', 2);
    source.set('children', list);
    list.push([{ id: 'c1' }, 'x']);

    const copy = cloneYValue(source) as Y.Map<unknown>;

    expect(copy).toBeInstanceOf(Y.Map);
    expect(copy).not.toBe(source);
    expect(copy.doc).toBeNull();
    doc.getMap('root').set('copy', copy);
    expect(toPlainValue(copy)).toEqual({ condition: 2, children: [{ id: 'c1' }, 'x'] });
    (copy.get('children') as Y.Array<unknown>).push(['added']);
    expect(toPlainValue(source)).toEqual({ condition: 2, children: [{ id: 'c1' }, 'x'] });

    // A native client's integer (yrs `Any::BigInt`) becomes the number Yjs can author.
    expect(cloneYValue(BigInt(7))).toBe(7);
    expect(cloneYValue('text')).toBe('text');
    expect(cloneYValue(null)).toBeNull();
  });

  it('reads integers from numbers and bigints only', () => {
    expect(readInteger(3)).toBe(3);
    expect(readInteger(2.5)).toBe(3);
    expect(readInteger(-2.4)).toBe(-2);
    // A half rounds toward +∞, as Rust `integer_value` does.
    expect(readInteger(-2.5)).toBe(-2);
    expect(readInteger(-2.6)).toBe(-3);
    expect(readInteger(BigInt(360))).toBe(360);
    expect(readInteger(Number.NaN)).toBeUndefined();
    expect(readInteger(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readInteger('4')).toBeUndefined();
    expect(readInteger(null)).toBeUndefined();
    expect(readInteger(undefined)).toBeUndefined();
  });

  it('reads numbers from numbers and bigints only', () => {
    expect(readNumber(0.25)).toBe(0.25);
    expect(readNumber(BigInt(-7))).toBe(-7);
    expect(readNumber(Number.NaN)).toBeUndefined();
    expect(readNumber('0.25')).toBeUndefined();
    expect(readNumber(true)).toBeUndefined();
  });

  it('clamps integers and falls back on anything else', () => {
    expect(clampInteger(BigInt(5000), 240, 1200, 360)).toBe(1200);
    expect(clampInteger(100, 240, 1200, 360)).toBe(240);
    expect(clampInteger(480.4, 240, 1200, 360)).toBe(480);
    expect(clampInteger('tall', 240, 1200, 360)).toBe(360);
  });

  it('reads booleans, falling back on the wrong type', () => {
    expect(readBoolean(false, true)).toBe(false);
    expect(readBoolean(true, false)).toBe(true);
    expect(readBoolean('false', true)).toBe(true);
    expect(readBoolean(0, false)).toBe(false);
    expect(readBoolean(undefined, true)).toBe(true);
  });

  it('reads a known string enum and leaves an unknown one unread and unwritten', () => {
    const allowed = ['auto', 'off', 'bottom'] as const;
    const stored = recordingMap({ legend_position: 'neon' });

    expect(readStringEnum('bottom', allowed, 'auto')).toBe('bottom');
    expect(readStringEnum(stored.get('legend_position'), allowed, 'auto')).toBe('auto');
    expect(readStringEnum(2, allowed, 'auto')).toBe('auto');
    expect(readStringEnum(undefined, allowed, 'off')).toBe('off');
    // Reading never writes the default back.
    expect(stored.set).not.toHaveBeenCalled();
    expect(stored.map.get('legend_position')).toBe('neon');
  });

  it('reads string lists, dropping other entries', () => {
    expect(readStringList(['a', 1, 'b', null, { c: 1 }])).toEqual(['a', 'b']);
    expect(readStringList('a')).toEqual([]);
    expect(readStringList(undefined)).toEqual([]);

    const doc = new Y.Doc();
    const list = doc.getArray<unknown>('list');

    list.push(['x', 2, 'y']);
    expect(readStringList(list)).toEqual(['x', 'y']);
  });

  it('reads non-empty strings', () => {
    expect(nonEmptyString('r:1')).toBe('r:1');
    expect(nonEmptyString('')).toBeUndefined();
    expect(nonEmptyString(1)).toBeUndefined();
  });

  it('compares persisted values deeply, numbers by value and keys in any order', () => {
    expect(sameLayoutValue(1, BigInt(1))).toBe(true);
    expect(sameLayoutValue(BigInt(2), 2.5)).toBe(false);
    expect(sameLayoutValue(Number.NaN, Number.NaN)).toBe(false);
    expect(sameLayoutValue('1', 1)).toBe(false);
    expect(
      sameLayoutValue(
        { a: 1, nested: { list: [1, 2], flag: true } },
        { nested: { flag: true, list: [BigInt(1), 2] }, a: 1 }
      )
    ).toBe(true);
    expect(sameLayoutValue([1, 2], [2, 1])).toBe(false);
    expect(sameLayoutValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameLayoutValue(null, undefined)).toBe(false);
    expect(sameLayoutValue([], {})).toBe(false);

    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('map');

    map.set('rows', [{ id: 'r:1', height: BigInt(360) }]);
    expect(sameLayoutValue(map, { rows: [{ height: 360, id: 'r:1' }] })).toBe(true);
  });

  it('writes a key only when its value changes', () => {
    const map = recordingMap({ height: BigInt(360), probe: { a: [1] } });

    expect(setLayoutKeyIfChanged(map, 'height', 360)).toBe(false);
    expect(setLayoutKeyIfChanged(map, 'probe', { a: [1] })).toBe(false);
    expect(map.set).not.toHaveBeenCalled();

    expect(setLayoutKeyIfChanged(map, 'height', 480)).toBe(true);
    expect(setLayoutKeyIfChanged(map, 'new_key', false)).toBe(true);
    expect(map.set).toHaveBeenCalledTimes(2);
    expect(map.map.get('height')).toBe(480);
    expect(map.map.get('new_key')).toBe(false);
  });

  it('picks the keys a record holds beyond the known ones', () => {
    const known = new Set(['id', 'height', 'widgets']);

    expect(pickUnknownKeys({ id: 'r:1', height: 360, widgets: [] }, known)).toBeUndefined();
    expect(pickUnknownKeys({ id: 'r:1', zz_parity_probe: { row: 'r:1' }, future: 1 }, known)).toEqual({
      zz_parity_probe: { row: 'r:1' },
      future: 1,
    });
  });

  it('turns Y types into plain JSON at any depth and keeps bigints', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const inner = new Y.Map<unknown>();
    const list = new Y.Array<unknown>();

    root.set('inner', inner);
    setParityValue(inner, 'height', BigInt(360));
    inner.set('list', list);
    list.push(['a', { plain: true }]);
    expect(toPlainValue(root)).toEqual({ inner: { height: BigInt(360), list: ['a', { plain: true }] } });
    expect(toPlainValue('text')).toBe('text');
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
  });
});
