/**
 * @jest-environment node
 *
 * Node provides TextEncoder and TextDecoder before lib0 loads, as a browser does. Under jsdom,
 * lib0 falls back to a polyfill that throws on a lone surrogate, so the jsdom suite
 * (server-acknowledged.test.ts) cannot build an update whose string starts inside a surrogate
 * pair. Yjs writes one whenever a diff starts inside a string item, at the clock a state vector
 * names.
 */
import * as Y from 'yjs';

import { YDoc } from '@/application/types';

import { isNoopForServer, readUpdateRanges, recordServerUpdate } from '../server-acknowledged';

/** Plain [start, end) pairs per client, for comparisons. */
function pairs(ranges: Map<number, number[]>): Record<number, number[][]> {
  const result: Record<number, number[][]> = {};

  ranges.forEach((flat, client) => {
    result[client] = [];
    for (let index = 0; index < flat.length; index += 2) result[client].push([flat[index], flat[index + 1]]);
  });
  return result;
}

/** The doc's delete set, merged into [start, end) pairs per client (Yjs internals, test only). */
function deleteSetOf(doc: Y.Doc): Record<number, number[][]> {
  const result: Record<number, number[][]> = {};
  const { clients } = Y.snapshot(doc).ds as unknown as { clients: Map<number, Array<{ clock: number; len: number }>> };

  clients.forEach((items, client) => {
    const list: number[][] = [];

    items.forEach(({ clock, len }) => {
      const last = list[list.length - 1];

      if (last && clock <= last[1]) last[1] = Math.max(last[1], clock + len);
      else list.push([clock, clock + len]);
    });
    if (list.length > 0) result[client] = list;
  });
  return result;
}

/** A diff for a peer that holds the first `clock` units of `client`. */
function diffFrom(doc: Y.Doc, client: number, clock: number): Uint8Array {
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(new Map([[client, clock]])));
}

/**
 * Text by one author with surrogate pairs, an emoji ZWJ sequence, a byte order mark and lone
 * surrogates. A deletion and a format boundary split items inside a pair, where Yjs writes U+FFFD
 * for both halves.
 */
function pageWithSurrogates(): Y.Doc {
  const doc = new Y.Doc();
  const text = doc.getText('body');

  text.insert(0, 'a😀b👩‍💻c🎉d﻿e');
  text.delete(2, 1);
  text.format(5, 2, { bold: true });
  text.insert(0, '\uD83D');
  text.insert(text.length, '\uDE00x🎈y');
  text.delete(text.length - 2, 1);
  return doc;
}

describe('readUpdateRanges with surrogate pairs (Node text codecs)', () => {
  test('reads every diff of a page, from every clock, with the clock lengths Yjs gives it', () => {
    const doc = pageWithSurrogates();
    const client = doc.clientID;
    const end = Y.decodeStateVector(Y.encodeStateVector(doc)).get(client)!;
    const deletes = deleteSetOf(doc);

    expect(Object.keys(deletes)).toHaveLength(1);
    for (let clock = 0; clock <= end; clock += 1) {
      const ranges = readUpdateRanges(diffFrom(doc, client, clock));

      expect(ranges).not.toBeNull();
      expect(pairs(ranges!.structs)).toEqual(clock < end ? { [client]: [[clock, end]] } : {});
      expect(pairs(ranges!.deletes)).toEqual(deletes);
    }
  });

  test('a server diff that starts inside a surrogate pair proves its own clocks and no earlier one', () => {
    const server = pageWithSurrogates();
    const client = server.clientID;
    const end = Y.decodeStateVector(Y.encodeStateVector(server)).get(client)!;

    for (let clock = 1; clock < end; clock += 1) {
      const doc = new Y.Doc() as YDoc;
      const diff = diffFrom(server, client, clock);

      expect(recordServerUpdate(doc, diff)).toBe(true);
      expect(isNoopForServer(doc, diff)).toBe(true);
      expect(isNoopForServer(doc, diffFrom(server, client, clock - 1))).toBe(false);
      doc.destroy();
    }

    server.destroy();
  });
});
