import * as Y from 'yjs';

import { setYMapBigInt } from '@/application/database-yjs/yjs-bigint';

const I64_MAX = BigInt('9223372036854775807');
const I64_MIN = BigInt('-9223372036854775808');

function createMap(clientID = 1) {
  const doc = new Y.Doc();

  doc.clientID = clientID;
  const parent = doc.getMap('root');
  const map = new Y.Map<unknown>();

  parent.set('setting', map);
  return { doc, parent, map };
}

function replicate(doc: Y.Doc, version: 'v1' | 'v2') {
  const replica = new Y.Doc();

  if (version === 'v1') {
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
  } else {
    Y.applyUpdateV2(replica, Y.encodeStateAsUpdateV2(doc));
  }

  return replica.getMap('root').get('setting') as Y.Map<unknown>;
}

/** lib0 `writeAny` bigint: type tag 122 followed by the big-endian int64. */
function bigInt64Bytes(value: bigint): number[] {
  const view = new DataView(new ArrayBuffer(8));

  view.setBigInt64(0, value);
  return [122, ...new Uint8Array(view.buffer)];
}

function containsBytes(haystack: Uint8Array, needle: number[]) {
  return Buffer.from(haystack).indexOf(Buffer.from(needle)) !== -1;
}

describe('setYMapBigInt', () => {
  it('exists because Y.Map.set rejects bigint values', () => {
    const { map } = createMap();

    expect(() => map.set('value', BigInt(1))).toThrow('Unexpected content type');
  });

  it.each([BigInt(0), BigInt(3), BigInt(-1), I64_MAX, I64_MIN])('stores %s as a bigint', (value) => {
    const { map } = createMap();

    setYMapBigInt(map, 'value', value);

    expect(typeof map.get('value')).toBe('bigint');
    expect(map.get('value')).toBe(value);
    expect(map.has('value')).toBe(true);
  });

  it.each(['v1', 'v2'] as const)('survives %s encode/decode as a bigint, not a number', (version) => {
    const { doc, map } = createMap();

    setYMapBigInt(map, 'small', BigInt(3));
    setYMapBigInt(map, 'max', I64_MAX);
    setYMapBigInt(map, 'min', I64_MIN);
    map.set('number', 3);

    const replica = replicate(doc, version);

    expect(replica.get('small')).toBe(BigInt(3));
    expect(replica.get('max')).toBe(I64_MAX);
    expect(replica.get('min')).toBe(I64_MIN);
    expect(replica.get('number')).toBe(3);
  });

  it('encodes the value as a lib0 BigInt64, the encoding yrs decodes as Any::BigInt', () => {
    const { doc, map } = createMap();

    setYMapBigInt(map, 'value', BigInt('0x0102030405060708'));

    expect(containsBytes(Y.encodeStateAsUpdate(doc), bigInt64Bytes(BigInt('0x0102030405060708')))).toBe(true);
    // A JS number is a varint (type 125) instead, which yrs reads as Any::Number.
    const numberDoc = createMap();

    numberDoc.map.set('value', 3);
    expect(containsBytes(Y.encodeStateAsUpdate(numberDoc.doc), [125, 3])).toBe(true);
  });

  it('replaces the previous entry like Y.Map.set, whatever its type', () => {
    const { doc, map } = createMap();

    map.set('value', 'text');
    setYMapBigInt(map, 'value', BigInt(1));
    expect(map.get('value')).toBe(BigInt(1));

    map.set('value', 2);
    setYMapBigInt(map, 'value', BigInt(3));
    setYMapBigInt(map, 'value', BigInt(4));

    expect(map.get('value')).toBe(BigInt(4));
    expect(map.size).toBe(1);
    expect(Array.from(map.keys())).toEqual(['value']);
    expect(replicate(doc, 'v1').get('value')).toBe(BigInt(4));
  });

  it('can be overwritten and deleted with the regular Y.Map API', () => {
    const { map } = createMap();

    setYMapBigInt(map, 'value', BigInt(1));
    map.set('value', 'text');
    expect(map.get('value')).toBe('text');

    setYMapBigInt(map, 'value', BigInt(2));
    map.delete('value');
    expect(map.has('value')).toBe(false);
    expect(map.get('value')).toBeUndefined();
  });

  it('fires map observers, deep observers and one incremental document update per call', () => {
    const { doc, parent, map } = createMap();
    const replica = new Y.Doc();
    const keyChanges: string[][] = [];
    const deepPaths: (string | number)[][] = [];
    const updates: Uint8Array[] = [];

    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    map.observe((event) => keyChanges.push(Array.from(event.keysChanged)));
    parent.observeDeep((events) => events.forEach((event) => deepPaths.push(event.path)));
    doc.on('update', (update: Uint8Array) => updates.push(update));

    setYMapBigInt(map, 'value', BigInt(7));

    expect(keyChanges).toEqual([['value']]);
    expect(deepPaths).toEqual([['setting']]);
    expect(updates).toHaveLength(1);

    Y.applyUpdate(replica, updates[0]);
    expect((replica.getMap('root').get('setting') as Y.Map<unknown>).get('value')).toBe(BigInt(7));
  });

  it('joins the surrounding transaction and keeps its origin', () => {
    const { doc, map } = createMap();
    const origin = { name: 'chart-settings' };
    const origins: unknown[] = [];
    let updates = 0;

    map.observe((event) => origins.push(event.transaction.origin));
    doc.on('update', () => {
      updates += 1;
    });

    doc.transact(() => {
      setYMapBigInt(map, 'a', BigInt(1));
      setYMapBigInt(map, 'b', BigInt(2));
      map.set('c', 'three');
    }, origin);

    expect(origins).toEqual([origin]);
    expect(updates).toBe(1);
  });

  it('is undone and redone by Y.UndoManager like any other map write', () => {
    const { map } = createMap();

    map.set('value', 1);
    const undoManager = new Y.UndoManager(map);

    setYMapBigInt(map, 'value', BigInt(2));
    expect(map.get('value')).toBe(BigInt(2));

    undoManager.undo();
    expect(map.get('value')).toBe(1);

    undoManager.redo();
    expect(map.get('value')).toBe(BigInt(2));
  });

  it('converges with concurrent writes from another client', () => {
    const { doc: docA, map: mapA } = createMap(1);
    const docB = new Y.Doc();

    docB.clientID = 2;
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const mapB = docB.getMap('root').get('setting') as Y.Map<unknown>;

    setYMapBigInt(mapA, 'value', BigInt(10));
    mapB.set('value', 20);
    setYMapBigInt(mapA, 'only_a', BigInt(1));

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(mapA.get('value')).toBe(mapB.get('value'));
    expect([BigInt(10), 20]).toContain(mapA.get('value'));
    expect(mapB.get('only_a')).toBe(BigInt(1));
  });

  it('throws for a map that is not integrated into a document', () => {
    const map = new Y.Map<unknown>();

    expect(() => setYMapBigInt(map, 'value', BigInt(1))).toThrow(
      'Cannot write bigint "value" to a Y.Map that is not in a document'
    );
  });

  it.each([I64_MAX + BigInt(1), I64_MIN - BigInt(1)])(
    'rejects %s, which lib0 would silently wrap to another 64-bit value',
    (value) => {
      const { doc, map } = createMap();
      const before = Y.encodeStateVector(doc);

      expect(() => setYMapBigInt(map, 'value', value)).toThrow(RangeError);
      expect(map.has('value')).toBe(false);
      expect(Y.encodeStateVector(doc)).toEqual(before);
    }
  );
});
