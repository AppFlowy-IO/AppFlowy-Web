import * as Y from 'yjs';

/**
 * Store a 64-bit integer under `key`, encoded the way desktop's yrs writes
 * `Any::BigInt`.
 *
 * `Y.Map.set` rejects bigint values (yjs' `typeMapSet` only accepts JSON-like
 * constructors), and a plain JS number is encoded as an integer that yrs
 * decodes as `Any::Number`. Desktop ignores some sidecar keys unless they are
 * `Any::BigInt` (the chart `date_condition` and `aggregation_type_pb`), so
 * those must be written through this helper. It does what `typeMapSet` does
 * for any other value: append a `ContentAny` item after the current entry for
 * `key`, which lib0 serializes as a BigInt64.
 *
 * The map must already be integrated into a document, and the value must fit
 * in an i64 (lib0 would silently wrap it, so peers would read another value).
 */
export function setYMapBigInt(map: Y.Map<unknown>, key: string, value: bigint): void {
  const doc = map.doc;

  if (!doc) {
    throw new Error(`Cannot write bigint "${key}" to a Y.Map that is not in a document`);
  }

  if (BigInt.asIntN(64, value) !== value) {
    throw new RangeError(`Cannot write bigint "${key}": ${value} does not fit in 64 bits`);
  }

  Y.transact(doc, (transaction) => {
    const left = map._map.get(key) ?? null;
    const clientId = doc.clientID;

    new Y.Item(
      Y.createID(clientId, Y.getState(doc.store, clientId)),
      left,
      left && left.lastId,
      null,
      null,
      map,
      key,
      new Y.ContentAny([value])
    ).integrate(transaction, 0);
  });
}
