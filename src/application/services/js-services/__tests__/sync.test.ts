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
    waitForDrain: jest.fn(async () => true),
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

describe('database row hydration sync', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('responds to row sync requests with full row state', () => {
    const doc = new Y.Doc({ guid: random.uuidv4() });
    const text = doc.getText('cell');
    const emit = jest.fn();
    const context: SyncContext = {
      doc,
      emit,
      collabType: Types.DatabaseRow,
    };

    text.insert(0, 'row-value');

    handleMessage(context, {
      objectId: doc.guid,
      collabType: Types.DatabaseRow,
      syncRequest: {
        stateVector: Y.encodeStateVector(doc),
        lastMessageId: { timestamp: 0, counter: 0 },
      },
    });

    const payload = emit.mock.calls[0]?.[0].collabMessage?.update?.payload;
    const mirror = new Y.Doc();

    Y.applyUpdate(mirror, payload);
    expect(mirror.getText('cell').toString()).toBe('row-value');
  });

  it('sends follow-up sync requests for rendered database rows', () => {
    jest.useFakeTimers();

    const doc = new Y.Doc({ guid: random.uuidv4() });
    const emit = jest.fn();
    const context: SyncContext = {
      doc,
      emit,
      collabType: Types.DatabaseRow,
    };

    const { cleanup } = initSync(context);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        collabMessage: expect.objectContaining({
          objectId: doc.guid,
          collabType: Types.DatabaseRow,
          syncRequest: expect.any(Object),
        }),
      })
    );

    jest.advanceTimersByTime(749);
    expect(emit).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1750);
    expect(emit).toHaveBeenCalledTimes(3);

    cleanup();
    jest.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(3);

    doc.destroy();
  });
});

interface QueuedSyncBus {
  clients: SyncContext[];
  online: boolean[];
  texts: Y.Text[];
  disconnect: (index: number) => void;
  reconnect: (index: number) => void;
  publishManifest: (index: number) => void;
  publishManifests: () => void;
  drain: () => void;
}

const createQueuedSyncBus = (clientCount: number): QueuedSyncBus => {
  outboxMock.__clearTestClients();

  const guid = random.uuidv4();
  const clients: SyncContext[] = [];
  const online = Array.from({ length: clientCount }, () => true);
  const queue: Array<{ sender: number; message: messages.IMessage }> = [];

  const enqueue = (sender: number, message: messages.IMessage) => {
    if (!online[sender]) return;
    queue.push({ sender, message });
  };

  for (let i = 0; i < clientCount; i += 1) {
    const doc = new Y.Doc({ guid });

    clients.push({
      doc,
      awareness: new awarenessProtocol.Awareness(doc),
      emit: (message) => enqueue(i, message),
      collabType: Types.Document,
    });
  }

  clients.forEach((client) => initSync(client));
  queue.length = 0;

  const publishManifest = (index: number) => {
    const client = clients[index];

    client.emit({
      collabMessage: {
        objectId: client.doc.guid,
        collabType: client.collabType,
        syncRequest: {
          stateVector: Y.encodeStateVector(client.doc),
          lastMessageId: { timestamp: 0, counter: 0 },
          version: client.doc.version,
        },
      },
    });
  };

  const publishManifests = () => {
    clients.forEach((_, index) => publishManifest(index));
  };

  const drain = () => {
    let guard = 0;

    while (queue.length > 0) {
      if (guard > 1_000) {
        throw new Error('sync queue did not settle');
      }

      guard += 1;
      const { sender, message } = queue.shift()!;

      if (!online[sender] || !message.collabMessage) continue;

      clients.forEach((client, index) => {
        if (index !== sender && online[index]) {
          handleMessage(client, message.collabMessage!);
        }
      });
    }
  };

  const disconnect = (index: number) => {
    online[index] = false;
  };

  const reconnect = (index: number) => {
    online[index] = true;
    publishManifests();
  };

  return {
    clients,
    online,
    texts: clients.map((client) => client.doc.getText('test')),
    disconnect,
    reconnect,
    publishManifest,
    publishManifests,
    drain,
  };
};

const expectTextConvergence = (texts: Y.Text[], expectedChars: string) => {
  const values = texts.map((text) => text.toString());

  expect(new Set(values).size).toBe(1);
  expect([...values[0]].sort().join('')).toBe(expectedChars);
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

  it('converges three online clients after concurrent same-position edits', () => {
    const { texts, publishManifests, drain } = createQueuedSyncBus(3);

    texts[0].insert(0, 'A');
    texts[1].insert(0, 'B');
    texts[2].insert(0, 'C');

    publishManifests();
    drain();

    expectTextConvergence(texts, 'ABC');
  });

  it('converges when one client edits offline and then reconnects', () => {
    const { texts, disconnect, reconnect, publishManifest, drain } = createQueuedSyncBus(3);

    disconnect(2);

    texts[0].insert(0, 'A');
    texts[1].insert(0, 'B');
    texts[2].insert(0, 'C');

    publishManifest(0);
    publishManifest(1);
    drain();

    expect(texts[0].toString()).toEqual(texts[1].toString());
    expect([...texts[0].toString()].sort().join('')).toBe('AB');
    expect(texts[2].toString()).toBe('C');

    reconnect(2);
    drain();

    expectTextConvergence(texts, 'ABC');
  });

  it('converges when two offline clients reconnect in ascending order', () => {
    const { texts, disconnect, reconnect, publishManifest, drain } = createQueuedSyncBus(3);

    disconnect(0);
    disconnect(1);

    texts[0].insert(0, 'A');
    texts[1].insert(0, 'B');
    texts[2].insert(0, 'C');

    publishManifest(2);
    drain();
    expect(texts.map((text) => text.toString())).toEqual(['A', 'B', 'C']);

    reconnect(0);
    drain();
    expect(texts[0].toString()).toEqual(texts[2].toString());
    expect([...texts[0].toString()].sort().join('')).toBe('AC');
    expect(texts[1].toString()).toBe('B');

    reconnect(1);
    drain();

    expectTextConvergence(texts, 'ABC');
  });

  it('converges when two offline clients reconnect in reverse order', () => {
    const { texts, disconnect, reconnect, publishManifest, drain } = createQueuedSyncBus(3);

    disconnect(0);
    disconnect(1);

    texts[0].insert(0, 'A');
    texts[1].insert(0, 'B');
    texts[2].insert(0, 'C');

    publishManifest(2);
    drain();
    expect(texts.map((text) => text.toString())).toEqual(['A', 'B', 'C']);

    reconnect(1);
    drain();
    expect(texts[1].toString()).toEqual(texts[2].toString());
    expect([...texts[1].toString()].sort().join('')).toBe('BC');
    expect(texts[0].toString()).toBe('A');

    reconnect(0);
    drain();

    expectTextConvergence(texts, 'ABC');
  });

  it('converges when all clients edit offline and reconnect left to right', () => {
    const { texts, disconnect, reconnect, drain } = createQueuedSyncBus(3);

    disconnect(0);
    disconnect(1);
    disconnect(2);

    texts[0].insert(0, 'A');
    texts[1].insert(0, 'B');
    texts[2].insert(0, 'C');

    reconnect(0);
    drain();
    expect(texts.map((text) => text.toString())).toEqual(['A', 'B', 'C']);

    reconnect(1);
    drain();
    expect(texts[0].toString()).toEqual(texts[1].toString());
    expect([...texts[0].toString()].sort().join('')).toBe('AB');
    expect(texts[2].toString()).toBe('C');

    reconnect(2);
    drain();

    expectTextConvergence(texts, 'ABC');
  });

  it('converges when all clients edit offline and reconnect right to left', () => {
    const { texts, disconnect, reconnect, drain } = createQueuedSyncBus(3);

    disconnect(0);
    disconnect(1);
    disconnect(2);

    texts[0].insert(0, 'A');
    texts[1].insert(0, 'B');
    texts[2].insert(0, 'C');

    reconnect(2);
    drain();
    expect(texts.map((text) => text.toString())).toEqual(['A', 'B', 'C']);

    reconnect(1);
    drain();
    expect(texts[1].toString()).toEqual(texts[2].toString());
    expect([...texts[1].toString()].sort().join('')).toBe('BC');
    expect(texts[0].toString()).toBe('A');

    reconnect(0);
    drain();

    expectTextConvergence(texts, 'ABC');
  });
});
