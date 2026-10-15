import { toBase64 } from 'lib0/buffer';
import * as Y from 'yjs';

import { decodeCreatedRowCollab, encodeCreationCollab } from '../creation/encoded-collab';

function fixture() {
  const doc = new Y.Doc();

  doc.getMap('data').set('value', 'created');
  return doc;
}

it('uses the fixed-width Rust EncodedCollab V1 envelope and verifies its vector', () => {
  const doc = fixture();
  const encoded = encodeCreationCollab(doc);
  const bytes = Buffer.from(encoded, 'base64');
  const vector = Y.encodeStateVector(doc);

  expect(bytes.readBigUInt64LE()).toBe(BigInt(vector.length));
  expect(bytes.subarray(8, 8 + vector.length)).toEqual(Buffer.from(vector));
  expect(bytes.readBigUInt64LE(8 + vector.length)).toBe(BigInt(Y.encodeStateAsUpdate(doc).length));
  expect(bytes.at(-1)).toBe(0);
  expect(decodeCreatedRowCollab(encoded)).toEqual({ state: Y.encodeStateAsUpdate(doc), encoder: 1 });
  doc.destroy();
});

it.each(['', 'invalid!', 'AA==AAAA', 'A==='])('rejects malformed base64 %s', (value) => {
  expect(() => decodeCreatedRowCollab(value)).toThrow();
});

it('rejects oversized and truncated length prefixes before allocating', () => {
  const bytes = new Uint8Array(20);

  new DataView(bytes.buffer).setBigUint64(0, 2n ** 63n, true);
  expect(() => decodeCreatedRowCollab(toBase64(bytes))).toThrow('Truncated');
  expect(() => decodeCreatedRowCollab(toBase64(new Uint8Array(512 * 1024 + 1)))).toThrow();
});

it('supports the legacy two-field envelope and explicit Option::None only', () => {
  const doc = fixture();
  const bytes = Buffer.from(encodeCreationCollab(doc), 'base64');

  expect(decodeCreatedRowCollab(bytes.subarray(0, -1).toString('base64')).encoder).toBe(1);
  expect(decodeCreatedRowCollab(Buffer.concat([bytes, Buffer.from([0])]).toString('base64')).encoder).toBe(1);
  expect(() => decodeCreatedRowCollab(Buffer.concat([bytes, Buffer.from([1])]).toString('base64'))).toThrow('versioned');
  expect(() => decodeCreatedRowCollab(Buffer.concat([bytes, Buffer.from([0, 0])]).toString('base64'))).toThrow('fields');
  doc.destroy();
});

it('rejects unsupported encoders without treating them as legacy envelopes', () => {
  const doc = fixture();
  const bytes = Buffer.from(encodeCreationCollab(doc), 'base64');

  bytes[bytes.length - 1] = 2;
  expect(() => decodeCreatedRowCollab(bytes.toString('base64'))).toThrow('Unsupported');
  doc.destroy();
});
