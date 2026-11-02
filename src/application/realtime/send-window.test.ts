import { CollabSendWindow, RealtimeBackpressureError } from './send-window';
import { OutboxDrainScheduler } from '../sync-outbox/drain-scheduler';

import { messages } from '@/proto/messages';

const update = (objectId: string, databaseRestoreId?: string): messages.IMessage => ({
  collabMessage: { objectId, update: { payload: new Uint8Array([1]), databaseRestoreId } },
});
const manifest = (objectId: string, version = ''): messages.IMessage => ({
  collabMessage: { objectId, syncRequest: { version } },
});

function fixture(options: { maxUpdates?: number; maxManifests?: number } = {}) {
  const send = jest.fn();
  const onUpdateStalled = jest.fn();
  const onManifestTimeout = jest.fn();
  const window = new CollabSendWindow({ send, onUpdateStalled, onManifestTimeout, ...options });

  window.setConnection(true, true);
  return { window, send, onUpdateStalled, onManifestTimeout };
}

describe('workspace realtime send window', () => {
  afterEach(() => jest.useRealTimers());

  it('decodes the existing server UpdateAck tag 7 and fixed64 Redis message ID', () => {
    // Message.collab_message -> object "a" -> UpdateAck(RID 42-7), from the server wire contract.
    const wire = Uint8Array.from([
      0x0a, 0x12, 0x0a, 0x01, 0x61, 0x3a, 0x0d, 0x0a, 0x0b,
      0x09, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0x10, 0x07,
    ]);
    const decoded = messages.Message.decode(wire).collabMessage;

    expect(decoded?.objectId).toBe('a');
    expect(decoded?.updateAck?.messageId?.timestamp.toString()).toBe('42');
    expect(decoded?.updateAck?.messageId?.counter).toBe(7);
  });

  it('bounds update attempts across objects and preserves same-object order until ACK', () => {
    const { window, send } = fixture({ maxUpdates: 2 });

    window.send(update('a'));
    expect(() => window.send(update('a'))).toThrow(RealtimeBackpressureError);
    window.send(update('b'));
    expect(() => window.send(update('c'))).toThrow(RealtimeBackpressureError);
    window.receive({ objectId: 'a', update: { payload: new Uint8Array([1]) } });
    expect(window.canSendUpdate('a')).toBe(false);
    window.receive({ objectId: 'a', updateAck: {} });
    window.send(update('a'));
    expect(send.mock.calls.map(([m]) => m.collabMessage.objectId)).toEqual(['a', 'b', 'a']);
    window.dispose();
  });

  it('does not let an ACK from a different database restore retire current work', () => {
    const { window } = fixture();

    window.send(update('row', 'current-restore'));
    window.receive({ objectId: 'row', updateAck: { databaseRestoreId: 'old-restore' } });
    expect(window.canSendUpdate('row')).toBe(false);
    window.receive({ objectId: 'row', updateAck: { databaseRestoreId: 'current-restore' } });
    expect(window.canSendUpdate('row')).toBe(true);
    window.dispose();
  });

  it('bounds payload bytes and admits one larger valid frame alone without spinning retries', () => {
    const { window, send } = fixture();
    const large = (id: string, bytes: number): messages.IMessage => ({
      collabMessage: { objectId: id, update: { payload: new Uint8Array(bytes).fill(1) } },
    });

    window.send(large('a', 6 * 1024 * 1024));
    expect(() => window.send(large('b', 4 * 1024 * 1024))).toThrow(RealtimeBackpressureError);
    expect(window.canSendUpdate('b')).toBe(false);
    window.receive({ objectId: 'a', updateAck: {} });
    expect(window.canSendUpdate('b')).toBe(true);
    window.send(large('b', 10 * 1024 * 1024));
    expect(window.canSendUpdate('c')).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    window.dispose();
  });

  it('paces a 1500-object manifest burst and coalesces queued requests to their latest state', () => {
    const { window, send } = fixture({ maxManifests: 4 });

    for (let i = 0; i < 1500; i++) window.send(manifest(String(i)));
    window.send(manifest('1499', 'new-version'));
    expect(send).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 1500; i++) {
      window.receive({ objectId: String(i), syncRequest: {} });
      expect(send.mock.calls.length - i - 1).toBeLessThanOrEqual(4);
    }
    expect(send).toHaveBeenCalledTimes(1500);
    expect(send.mock.calls[1499][0].collabMessage.syncRequest.version).toBe('new-version');
    window.dispose();
  });

  it('reclaims failed manifest reads without treating an update timeout as an ACK', () => {
    jest.useFakeTimers();
    const { window, onUpdateStalled, send } = fixture({ maxManifests: 1 });

    window.send(manifest('missing'));
    window.send(manifest('next'));
    jest.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(2);
    window.send(update('edit'));
    jest.advanceTimersByTime(30_000);
    expect(onUpdateStalled).toHaveBeenCalledTimes(1);
    expect(window.canSendUpdate('edit')).toBe(false);
    expect(() => window.send(update('edit'))).toThrow(RealtimeBackpressureError);
    window.disconnect();
    window.setConnection(true, true);
    expect(window.canSendUpdate('edit')).toBe(true);
    window.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears pending reads on disconnect and does not replay another connection generation', () => {
    const { window, send } = fixture({ maxManifests: 1 });

    window.send(manifest('old-a'));
    window.send(manifest('old-b'));
    window.disconnect();
    window.receive({ objectId: 'old-a', updateAck: {} });
    window.setConnection(true, true);
    window.send(manifest('fresh'));
    expect(send.mock.calls.map(([m]) => m.collabMessage.objectId)).toEqual(['old-a', 'fresh']);
    window.dispose();
  });

  it('keeps legacy servers usable without requiring transport ACKs they never advertised', () => {
    const { window, send } = fixture({ maxUpdates: 1 });

    window.disconnect();
    window.setConnection(true, false);
    for (let i = 0; i < 100; i++) window.send(update(String(i)));
    expect(send).toHaveBeenCalledTimes(100);
    window.setConnection(true, true);
    window.send(update('another'));
    expect(send).toHaveBeenCalledTimes(101);
    window.disconnect();
    window.setConnection(true, true);
    window.send(update('paced'));
    expect(window.canSendUpdate('paced')).toBe(false);
    window.dispose();
  });

  it('releases admission if the native send fails and ignores empty Yjs updates', () => {
    const { window, send } = fixture({ maxUpdates: 1 });

    send.mockImplementationOnce(() => { throw new Error('closed'); });
    expect(() => window.send(update('a'))).toThrow('closed');
    expect(window.canSendUpdate('a')).toBe(true);
    window.send({ collabMessage: { objectId: 'a', update: { payload: new Uint8Array([0, 0]) } } });
    expect(send).toHaveBeenCalledTimes(1);
    window.dispose();
  });

  it('bounds offered update bursts with the production outbox scheduler and resumes on ACK', async () => {
    const objects = 1500;
    const outstanding = new Set<string>();
    let sent = 0;
    let peak = 0;
    let expected = 32;
    let reached: () => void = () => undefined;
    let barrier = new Promise<void>((resolve) => { reached = resolve; });
    const window = new CollabSendWindow({
      send: (message) => {
        outstanding.add(message.collabMessage!.objectId!);
        peak = Math.max(peak, outstanding.size);
        if (++sent === expected) reached();
      },
      onUpdateStalled: () => { throw new Error('unexpected timeout'); },
      onManifestTimeout: () => { throw new Error('unexpected manifest'); },
    });

    window.setConnection(true, true);
    const scheduler = new OutboxDrainScheduler({
      concurrency: 8,
      canRun: (id) => window.canSendUpdate(id),
      run: async (id) => { window.send(update(id)); },
      onError: (_id, error) => { throw error; },
    });
    const unsubscribe = window.subscribeReady(() => scheduler.wake());

    for (let i = 0; i < objects; i++) scheduler.enqueue(String(i));
    while (sent < objects) {
      await barrier;
      expect(outstanding.size).toBeLessThanOrEqual(32);
      expected = Math.min(sent + 32, objects);
      barrier = new Promise<void>((resolve) => { reached = resolve; });
      for (const id of outstanding) {
        outstanding.delete(id);
        window.receive({ objectId: id, updateAck: {} });
      }
    }
    expect(sent).toBe(objects);
    expect(peak).toBe(32);
    unsubscribe();
    window.dispose();
  });
});
