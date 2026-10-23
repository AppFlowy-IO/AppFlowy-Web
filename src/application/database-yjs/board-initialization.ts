import { toHexString } from 'lib0/buffer';
import { digest } from 'lib0/hash/sha256';
import * as Y from 'yjs';

/**
 * Replay the same immutable initialization update on every replica. Stable
 * property IDs alone are insufficient: competing nested Y.Maps discard edits
 * made inside the losing map, and Y.Arrays retain duplicate insertions.
 *
 * The defaults and their destination determine a synthetic 53-bit client ID,
 * outside Yjs's randomly generated 32-bit client range. Only this isolated seed
 * uses it; subsequent user edits retain the live document's normal client ID.
 * Include every default in the hash so changed defaults never reuse a clock.
 */
function applyBoardInitialization(parent: Y.Map<unknown> | Y.Array<unknown>, key: string | null, value: unknown) {
  if (!parent.doc) throw new Error('Board defaults require an integrated Yjs type');
  const seed = new Y.Doc();

  seed.clientID = 0;
  if (key === null) seed.getArray('default').push([value]);
  else seed.getMap('default').set(key, value);
  const items = seed.store.clients.get(0) as Y.Item[];
  const first = items[0];

  // Reparent the seed's sole root insertion. Map replacements must follow the
  // previous entry (including tombstones); array defaults have no cursor, so
  // unrelated concurrent field-order edits cannot change their identity.
  first.parent = parent;
  first.origin = key === null ? null : parent._map.get(key)?.lastId ?? null;
  const hash = toHexString(digest(Y.encodeStateAsUpdate(seed)));
  const clientId = 2 ** 52 + Number.parseInt(hash.slice(0, 13), 16);
  const remap = (id: Y.ID | null) => (id?.client === 0 ? Y.createID(clientId, id.clock) : id);

  items.forEach((item, index) => {
    item.id = Y.createID(clientId, item.id.clock);
    if (index === 0) return; // Its parent and origin belong to the live document.
    item.origin = remap(item.origin);
    item.rightOrigin = remap(item.rightOrigin);
  });
  // Nested types refer to their parent Items, whose IDs were remapped above.
  seed.store.clients.delete(0);
  seed.store.clients.set(clientId, items);
  const update = Y.encodeStateAsUpdate(seed);

  seed.destroy();
  Y.applyUpdate(parent.doc, update);
}

export function setBoardInitializationValue(map: Y.Map<unknown>, key: string, value: unknown) {
  applyBoardInitialization(map, key, value);
}

export function insertBoardInitializationValue(array: Y.Array<unknown>, value: unknown) {
  applyBoardInitialization(array, null, value);
}
