import { handleMessage, initSync, SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types } from '@/application/types';
import { messages } from '@/proto/messages';
import { expect } from '@jest/globals';
import * as random from 'lib0/random';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

// Mock the persistent outbox — enqueues are immediately routed back through
// the owning SyncContext's emit, preserving the "local update -> remote apply"
// semantics the test relies on without touching IndexedDB.
jest.mock('@/application/sync-outbox', () => {
  // For tests, every SyncContext sharing an objectId emits the enqueued
  // message through its own emit closure. The closure forwards to all
  // *other* peers via handleMessage; routing through every registered
  // peer is harmless because applying your own update is a no-op in Yjs.
  const clientsByObjectId = new Map<string, SyncContext[]>();

  return {
    enqueueOutboxUpdate: jest.fn((record: { objectId: string; collabType: number; version?: string | null; payload: Uint8Array }) => {
      const peers = clientsByObjectId.get(record.objectId) ?? [];
      const message = {
        collabMessage: {
          objectId: record.objectId,
          collabType: record.collabType,
          update: {
            flags: 0,
            payload: record.payload,
            version: record.version ?? undefined,
          },
        },
      };

      peers.forEach((peer) => peer.emit(message));
    }),
    deleteOutboxByObjectId: jest.fn(async () => undefined),
    waitForDrain: jest.fn(async () => undefined),
    configureDrain: jest.fn(),
    clearDrainConfig: jest.fn(),
    startDrainAll: jest.fn(),
    setCurrentSession: jest.fn(),
    __registerTestClient: (ctx: SyncContext) => {
      const list = clientsByObjectId.get(ctx.doc.guid) ?? [];

      list.push(ctx);
      clientsByObjectId.set(ctx.doc.guid, list);
    },
    __clearTestClients: () => clientsByObjectId.clear(),
  };
});

/**
 * Default tracer function for logging messages sent by clients.
 * This function can be replaced with a custom tracer used to assertions etc.
 */
const defaultTracer = (message: messages.IMessage, i: number) => {
  console.debug(`Client ${i} sending message:`, message);
};

const outboxMock = jest.requireMock('@/application/sync-outbox');

const mockSync = (clientCount: number, tracer = defaultTracer): SyncContext[] => {
  outboxMock.__clearTestClients();

  const clients: SyncContext[] = [];
  const guid = random.uuidv4();

  for (let i = 0; i < clientCount; i++) {
    const doc = new Y.Doc({ guid });
    const awareness = new awarenessProtocol.Awareness(doc);

    clients.push({
      doc,
      awareness,
      emit: jest.fn(),
      collabType: Types.Document,
    });
  }

  for (let i = 0; i < clientCount; i++) {
    const client = clients[i];

    client.emit = (message: messages.IMessage) => {
      tracer(message, i);
      clients.forEach((otherClient, index) => {
        if (index !== i) {
          handleMessage(otherClient, message.collabMessage!);
        }
      });
    };
    // Only one client writes updates at a time in these tests; each doc
    // has the same guid, so we keep the latest emitter registered.
    outboxMock.__registerTestClient(client);
  }

  return clients;
};

describe('sync protocol', () => {
  it('should exchange updates between client and server', () => {
    const [local, remote] = mockSync(2);

    initSync(local);
    initSync(remote);

    const txt1 = local.doc.getText('test');
    const txt2 = remote.doc.getText('test');

    // local -> remote
    txt1.insert(0, 'Hello');
    expect(txt2.toString()).toEqual('Hello');

    // remote -> local
    txt2.insert(5, ' World');
    expect(txt1.toString()).toEqual('Hello World');
  });
});
