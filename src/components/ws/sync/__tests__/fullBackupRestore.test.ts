import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'node:v8';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { ServerRestoreBoundary } from '@/application/server-restore';

import { handleMessage, SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, YDoc } from '@/application/types';
import { messages } from '@/proto/messages';

import { versionChanged } from '../types';

beforeAll(() => Object.assign(globalThis, { structuredClone: (value: unknown) => deserialize(serialize(value)) }));

jest.mock('@/application/db', () => ({ deleteCollabDB: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({ shouldRouteUpdateThroughOutbox: () => false }));

// A full server backup preserves the captured collab version. This reproduces the
// reconnect handshake against that older state, without changing a running server.
test.each([undefined, '22222222-2222-4222-8222-222222222222'])(
  'an already-open page must not undo a full backup restore (collab version %s)',
  async (version) => {
    localStorage.clear();
    const generation = new ServerRestoreBoundary('https://cloud', localStorage, jest.fn());
    const restoredId = '33333333-3333-4333-8333-333333333333';
    const objectId = version ? '11111111-1111-4111-8111-111111111111' : '44444444-4444-4444-8444-444444444444';
    const browser = new Y.Doc({ guid: objectId }) as YDoc;
    const restoredServer = new Y.Doc({ guid: objectId });
    const replies: messages.IMessage[] = [];
    const oldCache = new IndexeddbPersistence(generation.cacheKey(objectId), browser);
    await oldCache.whenSynced;
    let reopened: YDoc | undefined;
    let restoredCache: IndexeddbPersistence | undefined;

    try {
      browser.version = version;
      browser.getMap('page').set('content', 'content at backup');
      const backup = Y.encodeStateAsUpdate(browser);

      browser.getMap('page').set('content', 'content after backup');
      Y.applyUpdate(restoredServer, backup);
      const context: SyncContext = {
        doc: browser, collabType: Types.Document, emit: (reply) => replies.push(reply),
      };
      const handshake = {
        objectId, collabType: Types.Document,
        syncRequest: { stateVector: Y.encodeStateVector(restoredServer), version },
      };

      // This is the same gate and handler used by useCollabMessageHandler.
      expect(versionChanged(context, handshake)).toBe(false);
      // Discovery stops this connection before useSync can send its state vector.
      expect(() => generation.accept(restoredId)).toThrow('reloading');
      await oldCache.destroy();
      browser.destroy();
      const reloaded = new ServerRestoreBoundary('https://cloud', localStorage, jest.fn());

      reopened = new Y.Doc({ guid: objectId }) as YDoc;
      reopened.version = version;
      restoredCache = new IndexeddbPersistence(reloaded.cacheKey(objectId), reopened);
      await restoredCache.whenSynced;
      expect(reopened.getMap('page').get('content')).toBeUndefined();
      Y.applyUpdate(reopened, backup);
      handleMessage({ ...context, doc: reopened }, handshake);
      for (const reply of replies) {
        if (reply.collabMessage?.update?.payload) {
          Y.applyUpdate(restoredServer, reply.collabMessage.update.payload);
        }
      }

      expect({
        openPage: reopened.getMap('page').get('content'),
        restoredServer: restoredServer.getMap('page').get('content'),
      }).toEqual({ openPage: 'content at backup', restoredServer: 'content at backup' });
    } finally {
      await oldCache.destroy();
      await restoredCache?.destroy();
      browser.destroy();
      reopened?.destroy();
      restoredServer.destroy();
    }
  }
);
