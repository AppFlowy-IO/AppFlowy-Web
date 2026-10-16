import { fromBase64, toBase64 } from 'lib0/buffer';
import * as Y from 'yjs';

/** Shared Rust EncodedCollab uses fixed-width bincode lengths, not a raw Yjs update. */
export function encodeCreationCollab(doc: Y.Doc): string {
  const vector = Y.encodeStateVector(doc);
  const state = Y.encodeStateAsUpdate(doc);
  const bytes = new Uint8Array(17 + vector.length + state.length);
  const view = new DataView(bytes.buffer);

  view.setBigUint64(0, BigInt(vector.length), true);
  bytes.set(vector, 8);
  view.setBigUint64(8 + vector.length, BigInt(state.length), true);
  bytes.set(state, 16 + vector.length);
  // EncoderVersion::V1 = 0; an absent collab_version is omitted by serde.
  return toBase64(bytes);
}

export function decodeBase64Bytes(value: string, limit: number): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(limit / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('Invalid creation response encoding');
  }

  const bytes = fromBase64(value);

  if (!bytes.length || bytes.length > limit) throw new Error('Creation response exceeds its size limit');
  return bytes;
}

/** Only unversioned newly committed rows may use this optional activation optimization. */
export function decodeCreatedRowCollab(encoded: string): { state: Uint8Array; encoder: 1 | 2 } {
  const bytes = decodeBase64Bytes(encoded, 512 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const readBytes = () => {
    if (offset + 8 > bytes.length) throw new Error('Truncated creation collab');
    const length = view.getBigUint64(offset, true);

    offset += 8;
    if (length > BigInt(bytes.length - offset)) throw new Error('Truncated creation collab');
    const result = bytes.subarray(offset, offset + Number(length));

    offset += Number(length);
    return result;
  };

  const vector = readBytes();
  const state = readBytes();
  const version = offset < bytes.length ? bytes[offset++] : 0;

  if ((version !== 0 && version !== 1) || !state.length || !vector.length) {
    throw new Error('Unsupported creation collab');
  }

  // A serialized Option::None suffix is valid; Some(version) is never a fresh Row hint.
  if (offset < bytes.length && bytes[offset++] !== 0) throw new Error('Created row is versioned');
  if (offset !== bytes.length) throw new Error('Unexpected creation collab fields');
  const doc = new Y.Doc();

  try {
    if (version === 0) Y.applyUpdate(doc, state);
    else Y.applyUpdateV2(doc, state);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Created row history is incomplete');
    const expected = Y.decodeStateVector(vector);
    const actual = Y.decodeStateVector(Y.encodeStateVector(doc));

    if (expected.size !== actual.size || [...expected].some(([client, clock]) => actual.get(client) !== clock)) {
      throw new Error('Created row state vector differs');
    }

    return { state, encoder: version === 0 ? 1 : 2 };
  } finally {
    doc.destroy();
  }
}
