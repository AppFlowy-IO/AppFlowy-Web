import * as Y from 'yjs';

import { YDoc } from '@/application/types';

import { isNoopForServer, recordServerDeletions } from '../server-deletions';

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
  recordServerDeletions(client, diff);
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

describe('isNoopForServer', () => {
  test('nothing is acknowledged before the server has sent its delete set', () => {
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

  test('a local pure deletion is a change even when every older deletion is acknowledged', () => {
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

  test('a local deletion the server has also made counts as acknowledged once the server sends it', () => {
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
    const updates: Uint8Array[] = [];

    server.on('update', (update: Uint8Array) => updates.push(update));
    server.getText('body').insert(0, 'abcdefghij');
    server.getText('body').delete(0, 3);
    server.getText('body').delete(0, 3);
    for (const update of updates) {
      Y.applyUpdate(client, update);
      recordServerDeletions(client, update);
    }

    // One reply range spans both server deletions.
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('a deletion only partly covered by acknowledged ranges is a change', () => {
    const server = new Y.Doc();

    server.getText('body').insert(0, 'abcdefghij');
    server.getText('body').delete(2, 2);
    const client = copyOf(server);

    receiveServerDiff(client, server);
    client.getText('body').delete(2, 1);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(false);
  });

  test('a server deletion whose item has not arrived yet is acknowledged while it is pending', () => {
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
    recordServerDeletions(client, deletion);
    expect(client.store.pendingDs).not.toBeNull();
    expect(isNoopForServer(client, Y.encodeStateAsUpdate(client, before))).toBe(true);
    Y.applyUpdate(client, insertion);
    expect(isNoopForServer(client, manifestReply(client, server))).toBe(true);
  });

  test('acknowledged deletions do not carry over to another collab version or restore generation', () => {
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

  test('unreadable bytes are never a no-op and record nothing', () => {
    const server = pageWithDeletionHistory();
    const client = copyOf(server);

    recordServerDeletions(client, new Uint8Array([0, 5, 200]));
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
});
