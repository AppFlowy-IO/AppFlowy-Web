import * as encoding from 'lib0/encoding';
import { digest } from 'lib0/hash/sha256';
import * as Y from 'yjs';

/** Matches appflowy-proto's canonical_delete_set_digest, not raw Yjs delete-set encoding. */
export function deleteSetDigest(doc: Y.Doc): Uint8Array {
  // Yjs snapshots coalesce adjacent deleted structs. Sort clients explicitly:
  // map insertion order and Yjs's wire ordering differ from the server's hash.
  const clients = Array.from(Y.snapshot(doc).ds.clients).sort(([left], [right]) => left - right);
  const encoded = encoding.createEncoder();
  const writeU64 = (value: number) => {
    encoding.writeUint32(encoded, value >>> 0);
    encoding.writeUint32(encoded, Math.floor(value / 0x100000000));
  };

  writeU64(clients.length);
  for (const [client, ranges] of clients) {
    const rangeEncoder = encoding.createEncoder();

    encoding.writeVarUint(rangeEncoder, ranges.length);
    for (const range of ranges) {
      encoding.writeVarUint(rangeEncoder, range.clock);
      encoding.writeVarUint(rangeEncoder, range.len);
    }

    const bytes = encoding.toUint8Array(rangeEncoder);

    writeU64(client);
    writeU64(bytes.length);
    encoding.writeUint8Array(encoded, bytes);
  }

  return digest(encoding.toUint8Array(encoded));
}
