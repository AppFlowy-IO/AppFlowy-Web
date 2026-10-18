import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { YDoc } from '@/application/types';

import {
  beginServerExchange,
  isNoopForServer,
  readUpdateRanges,
  recordServerUpdate,
} from '../server-acknowledged';

/** Deterministic PRNG (mulberry32) so a failing scenario can be replayed. */
function prng(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);

    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pageWithDeletionHistory(): Y.Doc {
  const doc = new Y.Doc();

  doc.getText('body').insert(0, 'Onboarding checklist: laptop, badge, DRAFT');
  doc.getText('body').delete(36, 6);
  return doc;
}

function copyOf(source: Y.Doc): YDoc {
  const doc = new Y.Doc() as YDoc;

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
  return doc;
}

/** The server's answer to `client`'s state vector, as the client records it. */
function receiveServerDiff(client: YDoc, server: Y.Doc) {
  const diff = Y.encodeStateAsUpdate(server, Y.encodeStateVector(client));

  Y.applyUpdate(client, diff);
  recordServerUpdate(client, diff);
}

/** The manifest reply: what the client would send for the server's state vector. */
function manifestReply(client: Y.Doc, server: Y.Doc) {
  return Y.encodeStateAsUpdate(client, Y.encodeStateVector(server));
}

function changesServer(server: Y.Doc, update: Uint8Array): boolean {
  const probe = copyOf(server);
  const before = Y.snapshot(probe);

  Y.applyUpdate(probe, update);
  const changed = !Y.equalSnapshots(before, Y.snapshot(probe));

  probe.destroy();
  return changed;
}

function hasStructs(update: Uint8Array) {
  return Y.parseUpdateMeta(update).to.size > 0;
}

/** Collects the updates a doc emits while `edit` runs. */
function updatesOf(doc: Y.Doc, edit: () => void): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const listener = (update: Uint8Array) => updates.push(update);

  doc.on('update', listener);
  edit();
  doc.off('update', listener);
  return updates;
}

/** Plain [start, end) pairs per client, for comparisons. */
function pairs(ranges: Map<number, number[]>): Record<number, number[][]> {
  const result: Record<number, number[][]> = {};

  ranges.forEach((flat, client) => {
    result[client] = [];
    for (let index = 0; index < flat.length; index += 2) result[client].push([flat[index], flat[index + 1]]);
  });
  return result;
}

/** Reference delete set: Yjs's own diffUpdate drops every struct, then the bare delete set is read. */
function referenceDeletes(update: Uint8Array): Record<number, number[][]> {
  const covering = new Map<number, number>();

  Y.parseUpdateMeta(update).to.forEach((clock, client) => covering.set(client, clock));
  const encoder = encoding.createEncoder();

  encoding.writeVarUint(encoder, covering.size);
  covering.forEach((clock, client) => {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, clock);
  });
  const decoder = decoding.createDecoder(Y.diffUpdate(update, encoding.toUint8Array(encoder)));

  expect(decoding.readVarUint(decoder)).toBe(0);
  const result: Record<number, number[][]> = {};

  for (let clients = decoding.readVarUint(decoder); clients > 0; clients -= 1) {
    const client = decoding.readVarUint(decoder);
    const list: number[][] = [];

    for (let count = decoding.readVarUint(decoder); count > 0; count -= 1) {
      const clock = decoding.readVarUint(decoder);
      const length = decoding.readVarUint(decoder);
      const last = list[list.length - 1];

      if (length === 0) continue;
      if (last && clock <= last[1]) last[1] = Math.max(last[1], clock + length);
      else list.push([clock, clock + length]);
    }

    if (list.length > 0) result[client] = list;
  }

  return result;
}

/** A structless update whose delete set lists `deletes` (client -> flat [start, end) pairs). */
function deletionUpdate(deletes: Map<number, number[]>): Uint8Array {
  const encoder = encoding.createEncoder();

  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, deletes.size);
  deletes.forEach((flat, client) => {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, flat.length / 2);
    for (let index = 0; index < flat.length; index += 2) {
      encoding.writeVarUint(encoder, flat[index]);
      encoding.writeVarUint(encoder, flat[index + 1] - flat[index]);
    }
  });
  return encoding.toUint8Array(encoder);
}

/** A doc that uses every kind of Yjs content, with deletions and garbage-collected parts. */
function docWithEveryContentKind(): Y.Doc {
  const doc = new Y.Doc();
  const text = doc.getText('text');
  const map = doc.getMap('map');
  const list = doc.getArray<unknown>('list');
  const xml = doc.getXmlFragment('xml');

  text.insert(0, 'Plain ASCII, accents éàü, and emoji 👩‍💻🎉 in one run');
  text.format(0, 5, { bold: true });
  text.insertEmbed(3, { image: 'https://example.test/a.png' });
  text.delete(10, 4);
  map.set('number', 42);
  map.set('object', { nested: [1, 'two', null, true], big: 2n ** 40n });
  map.set('bytes', new Uint8Array([1, 2, 3]));
  map.set('subdoc', new Y.Doc({ guid: 'subdoc-guid' }));
  map.set('number', 43);
  const element = new Y.XmlElement('paragraph');
  const hook = new Y.XmlHook('mention');
  const xmlText = new Y.XmlText();

  // Yjs accepts hooks in a fragment; its typings list only elements and text.
  xml.insert(0, [element, hook as unknown as Y.XmlElement, xmlText]);
  element.setAttribute('align', 'left');
  xmlText.insert(0, 'Xml text 💡');
  list.insert(0, ['a', 'b', 'c', 'd', 'e', new Y.Array(), new Y.Text('nested'), new Y.XmlFragment()]);
  list.move(0, 4);
  list.moveRange(1, 2, 0);
  const nested = new Y.Map();

  list.insert(0, [nested, new Y.Map()]);
  nested.set('gone', 'with its parent');
  list.delete(0, 1);
  return doc;
}

/** The kinds of struct a doc holds, as Yjs names them (internal store, test only). */
function structKinds(doc: Y.Doc): string[] {
  const kinds = new Set<string>();
  const clients = (doc.store as unknown as { clients: Map<number, Array<Y.Item | Y.GC>> }).clients;

  clients.forEach((structs) =>
    structs.forEach((struct) => {
      if (!(struct instanceof Y.Item)) {
        kinds.add(struct.constructor.name);
        return;
      }

      const content = struct.content as Y.ContentType | { constructor: { name: string } };

      kinds.add(
        content instanceof Y.ContentType ? `ContentType:${content.type.constructor.name}` : content.constructor.name
      );
    })
  );
  return Array.from(kinds).sort();
}

describe('Yjs diffs always carry the complete delete set (root cause)', () => {
  test('encodeStateAsUpdate against a covering state vector is not empty once the history has a deletion', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);
    const reply = manifestReply(client, server);

    expect(Array.from(reply)).not.toEqual([0, 0]);
    expect(hasStructs(reply)).toBe(false);
    // The bytes are a no-op for the server: nothing in its state changes.
    expect(changesServer(server, reply)).toBe(false);
  });

  test('diffUpdate keeps the complete delete set as well', () => {
    const server = pageWithDeletionHistory();
    const diff = Y.diffUpdate(Y.encodeStateAsUpdate(copyOf(server)), Y.encodeStateVector(server));

    expect(Array.from(diff)).not.toEqual([0, 0]);
    expect(hasStructs(diff)).toBe(false);
    expect(changesServer(server, diff)).toBe(false);
  });

  test('a history without deletions gives the empty update', () => {
    const server = new Y.Doc();

    server.getText('body').insert(0, 'Holiday policy');
    expect(Array.from(manifestReply(copyOf(server), server))).toEqual([0, 0]);
  });
});

describe('readUpdateRanges', () => {
  test('reads every kind of content with the clock lengths Yjs gives it', () => {
    const doc = docWithEveryContentKind();
    const full = Y.encodeStateAsUpdate(doc);

    expect(structKinds(doc)).toEqual([
      'ContentAny',
      'ContentBinary',
      'ContentDeleted',
      'ContentDoc',
      'ContentEmbed',
      'ContentFormat',
      'ContentMove',
      'ContentString',
      'ContentType:YArray',
      'ContentType:YMap',
      'ContentType:YText',
      'ContentType:YXmlElement',
      'ContentType:YXmlFragment',
      'ContentType:YXmlHook',
      'ContentType:YXmlText',
      'GC',
    ]);
    const ranges = readUpdateRanges(full);
    const expectedStructs: Record<number, number[][]> = {};

    Y.decodeStateVector(Y.encodeStateVector(doc)).forEach((clock, client) => {
      expectedStructs[client] = [[0, clock]];
    });
    expect(ranges).not.toBeNull();
    expect(pairs(ranges!.structs)).toEqual(expectedStructs);
    expect(pairs(ranges!.deletes)).toEqual(referenceDeletes(full));
    expect(Object.keys(referenceDeletes(full)).length).toBeGreaterThan(0);
  });

  test('reads incremental updates like Yjs, struct ranges and delete sets alike', () => {
    const doc = new Y.Doc();
    const updates = updatesOf(doc, () => {
      const content = docWithEveryContentKind();

      Y.applyUpdate(doc, Y.encodeStateAsUpdate(content));
      doc.getText('text').delete(0, 3);
      doc.getText('text').insert(2, '🎈 more');
      doc.getMap('map').delete('object');
      doc.getArray('list').move(1, 0);
    });

    expect(updates.length).toBeGreaterThan(3);
    for (const update of updates) {
      const ranges = readUpdateRanges(update)!;
      const meta = Y.parseUpdateMeta(update);
      const expectedStructs: Record<number, number[][]> = {};

      meta.from.forEach((from, client) => {
        expectedStructs[client] = [[from, meta.to.get(client)!]];
      });
      expect(pairs(ranges.structs)).toEqual(expectedStructs);
      expect(pairs(ranges.deletes)).toEqual(referenceDeletes(update));
    }
  });

  test('reads legacy JSON content, which current Yjs no longer writes, as Yjs applies it', () => {
    // One Item at the root array 'list' holding two legacy JSON entries, then an empty delete set.
    const encoder = encoding.createEncoder();

    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint(encoder, 7);
    encoding.writeVarUint(encoder, 0);
    encoding.writeUint8(encoder, 2);
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarString(encoder, 'list');
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarString(encoder, '"a"');
    encoding.writeVarString(encoder, 'undefined');
    encoding.writeVarUint(encoder, 0);
    const update = encoding.toUint8Array(encoder);
    const doc = new Y.Doc();

    Y.applyUpdate(doc, update);
    expect(doc.getArray('list').toArray()).toEqual(['a', undefined]);
    expect(pairs(readUpdateRanges(update)!.structs)).toEqual({ 7: [[0, 2]] });
  });

  test('leaves out the gaps that merged updates mark with Skip structs', () => {
    const doc = new Y.Doc();
    const [first, second, third] = updatesOf(doc, () => {
      doc.getText('body').insert(0, 'abcde');
      doc.getText('body').insert(5, 'fgh');
      doc.getText('body').insert(8, 'ijkl');
    });
    const merged = Y.mergeUpdates([first, third]);
    const client = doc.clientID;

    // parseUpdateMeta reports one span over the gap; the gap is not part of the update.
    expect(Y.parseUpdateMeta(merged).to.get(client)).toBe(12);
    expect(pairs(readUpdateRanges(merged)!.structs)).toEqual({ [client]: [[0, 5], [8, 12]] });
    expect(pairs(readUpdateRanges(second)!.structs)).toEqual({ [client]: [[5, 8]] });
  });

  test('rejects bytes that are not one complete v1 update', () => {
    const update = Y.encodeStateAsUpdate(pageWithDeletionHistory());

    expect(readUpdateRanges(update.slice(0, update.length - 1))).toBeNull();
    expect(readUpdateRanges(Uint8Array.from([...update, 0]))).toBeNull();
    expect(readUpdateRanges(new Uint8Array([1, 1, 7, 0, 0xff]))).toBeNull();
  });
});

describe('isNoopForServer', () => {
  test('nothing is proven before the server has sent anything', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('deletions the server sent make the reply a no-op', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    receiveServerDiff(client, server);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('a local pure deletion is a change even when every older deletion is proven', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    receiveServerDiff(client, server);
    client.getText('body').delete(0, 1);
    const reply = manifestReply(client, server);

    expect(hasStructs(reply)).toBe(false);
    expect(isNoopForServer(client, reply)).toBe(false);
    expect(changesServer(server, reply)).toBe(true);
  });

  test('a local insertion is a change', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    receiveServerDiff(client, server);
    client.getText('body').insert(0, 'x');
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('a local deletion the server has also made counts as held once the server sends it', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    client.getText('body').delete(0, 4);
    server.getText('body').delete(0, 4);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
    receiveServerDiff(client, server);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('deletions recorded from incremental server updates accumulate, including adjacent ranges', () => {
    const server = new Y.Doc();
    const client = new Y.Doc() as YDoc;
    const updates = updatesOf(server, () => {
      server.getText('body').insert(0, 'abcdefghij');
      server.getText('body').delete(0, 3);
      server.getText('body').delete(0, 3);
    });

    for (const update of updates) {
      Y.applyUpdate(client, update);
      recordServerUpdate(client, update);
    }

    // One reply range spans both server deletions.
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('a deletion only partly covered by proven ranges is a change', () => {
    const server = new Y.Doc();

    server.getText('body').insert(0, 'abcdefghij');
    server.getText('body').delete(2, 2);
    const client = copyOf(server);

    receiveServerDiff(client, server);
    client.getText('body').delete(2, 1);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('a server deletion whose item has not arrived yet is held while it is pending', () => {
    const server = new Y.Doc();
    const client = new Y.Doc() as YDoc;

    server.getText('body').insert(0, 'abc');
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    const before = Y.encodeStateVector(server);

    server.getText('body').insert(3, 'def');
    const insertion = Y.encodeStateAsUpdate(server, before);
    const afterInsertion = Y.encodeStateVector(server);

    server.getText('body').delete(3, 3);
    const deletion = Y.encodeStateAsUpdate(server, afterInsertion);

    // The deletion overtakes the insertion it refers to.
    Y.applyUpdate(client, deletion);
    recordServerUpdate(client, deletion);
    expect(client.store.pendingDs).not.toBeNull();
    expect(isNoopForServer(client, Y.encodeStateAsUpdate(client, before))).toBe(true);
    Y.applyUpdate(client, insertion);
    recordServerUpdate(client, insertion);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('structs of an established author that the server relayed make a lagging request a no-op', () => {
    const author = pageWithDeletionHistory();
    const server = copyOf(author);
    const client = copyOf(server);

    receiveServerDiff(client, server);
    const lagging = Y.encodeStateVector(server);
    // The author has history in this page, so its new structs start well after clock 0.
    const [relayed] = updatesOf(author, () => author.getText('body').insert(0, 'New: '));

    expect(Y.parseUpdateMeta(relayed).from.get(author.clientID)).toBeGreaterThan(0);
    Y.applyUpdate(server, relayed);
    Y.applyUpdate(client, relayed);
    recordServerUpdate(client, relayed);
    const reply = Y.encodeStateAsUpdate(client, lagging);

    expect(hasStructs(reply)).toBe(true);
    expect(changesServer(server, reply)).toBe(false);
    expect(isNoopForServer(client, reply)).toBe(true);

    // The same lagging request with an unsent local insertion is a change.
    client.getText('body').insert(0, '!');
    expect(isNoopForServer(client, Y.encodeStateAsUpdate(client, lagging))).toBe(false);
  });

  test('a gap the server never sent stays unproven', () => {
    const author = new Y.Doc();
    const [first, second, third] = updatesOf(author, () => {
      author.getText('body').insert(0, 'abcde');
      author.getText('body').insert(5, 'fgh');
      author.getText('body').insert(8, 'ijkl');
    });
    const client = new Y.Doc() as YDoc;

    // A relayed merge of the first and third update leaves the second one out.
    recordServerUpdate(client, Y.mergeUpdates([first, third]));
    Y.applyUpdate(client, first);
    Y.applyUpdate(client, second);
    Y.applyUpdate(client, third);
    expect(isNoopForServer(client, Y.encodeStateAsUpdate(client))).toBe(false);
    expect(isNoopForServer(client, first)).toBe(true);
    expect(isNoopForServer(client, third)).toBe(true);
    expect(isNoopForServer(client, second)).toBe(false);
  });

  test('proven state does not carry over to another collab version or restore generation', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    client.version = 'version-a';
    client.databaseRestoreId = 'restore-a';
    receiveServerDiff(client, server);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
    client.version = 'version-b';
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
    client.version = 'version-a';
    client.databaseRestoreId = 'restore-b';
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('unreadable bytes are never a no-op and prove nothing', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    recordServerUpdate(client, new Uint8Array([0, 5, 200]));
    expect(isNoopForServer(client, new Uint8Array([0, 1, 200]))).toBe(false);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('agrees exactly with applying the reply to the server over random histories', () => {
    const outcomes = { noop: 0, deletionOnlyChange: 0, structChange: 0 };
    const mismatches: number[] = [];

    for (let seed = 1; seed <= 200; seed += 1) {
      const random = prng(seed);
      const edit = (doc: Y.Doc, steps: number) => {
        const text = doc.getText('body');

        for (let step = 0; step < steps; step += 1) {
          if (text.length > 0 && random() < 0.5) {
            const index = Math.floor(random() * text.length);

            text.delete(index, 1 + Math.floor(random() * Math.min(3, text.length - index)));
          } else {
            text.insert(Math.floor(random() * (text.length + 1)), 'xyz'.slice(0, 1 + Math.floor(random() * 3)));
          }
        }
      };

      const server = new Y.Doc();

      edit(server, 12);
      const client = copyOf(server);

      // Concurrent work on both sides: none, deletions only, or any edit.
      edit(server, Math.floor(random() * 4));
      const local = random();

      if (local < 0.3) {
        const text = client.getText('body');

        for (let step = 1 + Math.floor(random() * 2); step > 0 && text.length > 0; step -= 1) {
          text.delete(Math.floor(random() * text.length), 1);
        }
      } else if (local < 0.6) {
        edit(client, 1 + Math.floor(random() * 2));
      }

      receiveServerDiff(client, server);
      const reply = manifestReply(client, server);
      const noop = isNoopForServer(client, reply);

      if (noop === changesServer(server, reply)) mismatches.push(seed);
      if (noop) outcomes.noop += 1;
      else if (hasStructs(reply)) outcomes.structChange += 1;
      else outcomes.deletionOnlyChange += 1;
    }

    expect(mismatches).toEqual([]);
    // Every kind of reply occurred, so the agreement is not vacuous.
    expect(outcomes.noop).toBeGreaterThan(20);
    expect(outcomes.deletionOnlyChange).toBeGreaterThan(20);
    expect(outcomes.structChange).toBeGreaterThan(20);
  });

  test('agrees with the server for requests that are behind it, as a lagging sibling tab sends', () => {
    const outcomes = { noop: 0, change: 0, repeatsServerStructs: 0 };
    const mismatches: number[] = [];

    for (let seed = 1; seed <= 200; seed += 1) {
      const random = prng(seed);
      const authors = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
      const server = new Y.Doc();
      const relay = (author: Y.Doc, edit: (text: Y.Text) => void) => {
        Y.applyUpdate(author, Y.encodeStateAsUpdate(server));
        const before = Y.encodeStateVector(author);

        edit(author.getText('body'));
        const update = Y.encodeStateAsUpdate(author, before);

        Y.applyUpdate(server, update);
        return update;
      };

      const randomEdit = (text: Y.Text) => {
        if (text.length > 2 && random() < 0.4) text.delete(Math.floor(random() * (text.length - 1)), 1);
        else text.insert(Math.floor(random() * (text.length + 1)), 'ab'.slice(0, 1 + Math.floor(random() * 2)));
      };

      for (let step = 0; step < 6; step += 1) relay(authors[Math.floor(random() * 3)], randomEdit);
      const client = copyOf(server);
      const lagging = Y.encodeStateVector(server);

      receiveServerDiff(client, server);
      // Live updates the server relays to this tab with a message id, which the sibling has not seen.
      for (let step = Math.floor(random() * 4); step > 0; step -= 1) {
        const update = relay(authors[Math.floor(random() * 3)], randomEdit);

        Y.applyUpdate(client, update);
        recordServerUpdate(client, update);
      }

      // Sometimes a local edit that never reached the server.
      if (random() < 0.4) randomEdit(client.getText('body'));
      const reply = Y.encodeStateAsUpdate(client, lagging);
      const noop = isNoopForServer(client, reply);

      if (noop === changesServer(server, reply)) mismatches.push(seed);
      if (noop) outcomes.noop += 1;
      else outcomes.change += 1;
      if (noop && hasStructs(reply)) outcomes.repeatsServerStructs += 1;
    }

    expect(mismatches).toEqual([]);
    expect(outcomes.change).toBeGreaterThan(20);
    expect(outcomes.repeatsServerStructs).toBeGreaterThan(20);
  });
});

describe('server exchanges', () => {
  test('a state-vector request forgets earlier proof until the server proves its state again', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    receiveServerDiff(client, server);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);

    beginServerExchange(client);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);

    receiveServerDiff(client, server);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('an Update that cannot be read as v1 proves nothing', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    beginServerExchange(client);
    expect(recordServerUpdate(client, null)).toBe(false);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('reports whether the record grew, so repeated server state costs nothing', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);
    const diff = Y.encodeStateAsUpdate(server, Y.encodeStateVector(client));

    expect(recordServerUpdate(client, diff)).toBe(true);
    expect(recordServerUpdate(client, diff)).toBe(false);
  });

  test('merging recorded ranges matches a plain set of clocks', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const random = prng(seed);
      const client = new Y.Doc() as YDoc;
      const held = new Map<number, Set<number>>();

      for (let batch = 0; batch < 12; batch += 1) {
        const deletes = new Map<number, number[]>();
        // Small batches insert range by range, large ones merge whole lists.
        const size = random() < 0.5 ? 1 + Math.floor(random() * 6) : 9 + Math.floor(random() * 30);

        for (let count = 0; count < size; count += 1) {
          const owner = 1 + Math.floor(random() * 3);
          const start = Math.floor(random() * 400);
          const end = start + 1 + Math.floor(random() * 6);
          const flat = deletes.get(owner) ?? [];
          const clocks = held.get(owner) ?? new Set<number>();

          for (let clock = start; clock < end; clock += 1) clocks.add(clock);
          held.set(owner, clocks);
          // Keep each client's list in the sorted, merged form Yjs writes.
          const merged: number[][] = [];

          for (let index = 0; index < flat.length; index += 2) merged.push([flat[index], flat[index + 1]]);
          merged.push([start, end]);
          merged.sort((left, right) => left[0] - right[0]);
          const normalized: number[] = [];

          for (const [rangeStart, rangeEnd] of merged) {
            if (normalized.length > 0 && rangeStart <= normalized[normalized.length - 1]) {
              normalized[normalized.length - 1] = Math.max(normalized[normalized.length - 1], rangeEnd);
            } else {
              normalized.push(rangeStart, rangeEnd);
            }
          }

          deletes.set(owner, normalized);
        }

        recordServerUpdate(client, deletionUpdate(deletes));
        for (let query = 0; query < 25; query += 1) {
          const owner = 1 + Math.floor(random() * 3);
          const start = Math.floor(random() * 410);
          const end = start + 1 + Math.floor(random() * 8);
          let expected = true;

          for (let clock = start; clock < end && expected; clock += 1) expected = held.get(owner)?.has(clock) ?? false;
          expect(isNoopForServer(client, deletionUpdate(new Map([[owner, [start, end]]])))).toBe(expected);
        }
      }
    }
  });
});
