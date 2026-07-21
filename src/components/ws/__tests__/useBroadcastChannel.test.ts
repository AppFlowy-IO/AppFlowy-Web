import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { messages } from '@/proto/messages';

import { useBroadcastChannel } from '../useBroadcastChannel';

// jsdom does not implement BroadcastChannel; install a recording mock so the
// tests can assert on channel lifecycle (create/post/close) per instance.
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  name: string;
  closed = false;
  postMessage = jest.fn((data: unknown) => {
    if (this.closed) {
      const error = new Error('Channel is closed');

      error.name = 'InvalidStateError';
      throw error;
    }

    void data;
  });

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emitMessage(data: unknown) {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

describe('useBroadcastChannel', () => {
  const originalBroadcastChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.instances = [];
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = MockBroadcastChannel;
  });

  afterAll(() => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = originalBroadcastChannel;
  });

  const message: messages.IMessage = {};

  it('posts messages on the active channel', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    act(() => {
      result.current.postMessage(message);
    });

    expect(MockBroadcastChannel.instances).toHaveLength(1);
    expect(MockBroadcastChannel.instances[0].postMessage).toHaveBeenCalledTimes(1);
    // protobufjs may emit Buffer (a Uint8Array subclass from another realm in
    // jsdom), so assert on shape rather than constructor identity.
    const payload = MockBroadcastChannel.instances[0].postMessage.mock.calls[0][0] as Uint8Array;

    expect(typeof payload.byteLength).toBe('number');
  });

  it('flushes protocol messages emitted before the channel effect opens', () => {
    renderHook(() => {
      const channel = useBroadcastChannel('workspace:A');

      useLayoutEffect(() => {
        channel.postMessage(message);
      }, [channel.postMessage]);

      return channel;
    });

    expect(MockBroadcastChannel.instances).toHaveLength(1);
    expect(MockBroadcastChannel.instances[0].postMessage).toHaveBeenCalledTimes(1);
  });

  it('exposes received messages as lastBroadcastMessage', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    const encoded = messages.Message.encode(message).finish();

    act(() => {
      MockBroadcastChannel.instances[0].emitMessage(encoded);
    });

    expect(result.current.lastBroadcastMessage).toBeInstanceOf(messages.Message);
  });

  it('notifies transport subscribers for every received message', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });
    const listener = jest.fn();
    const unsubscribe = result.current.subscribeProtocolMessages(listener);
    const encoded = messages.Message.encode(message).finish();

    act(() => {
      MockBroadcastChannel.instances[0].emitMessage(encoded);
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBeInstanceOf(messages.Message);

    unsubscribe();
    act(() => {
      MockBroadcastChannel.instances[0].emitMessage(encoded);
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('routes durable-outbox signals without decoding them as protobuf messages', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });
    const listener = jest.fn();

    result.current.subscribeOutboxReady(listener);
    act(() => {
      result.current.postOutboxReady('workspace-1', 'object-1');
    });

    expect(MockBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({
      type: 'outbox-ready',
      workspaceId: 'workspace-1',
      objectId: 'object-1',
    });

    act(() => {
      MockBroadcastChannel.instances[0].emitMessage({
        type: 'outbox-ready',
        workspaceId: 'workspace-1',
        objectId: 'object-1',
      });
    });

    expect(listener).toHaveBeenCalledWith('workspace-1', 'object-1');
    expect(result.current.lastBroadcastMessage).toBeNull();
  });

  it('routes transport signals without exposing them as protocol messages', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });
    const listener = jest.fn();
    const signal = {
      type: 'transport-status' as const,
      workspaceId: 'A',
      readyState: WebSocket.OPEN,
    };

    result.current.subscribeTransportSignals(listener);
    act(() => {
      result.current.postTransportSignal(signal);
      MockBroadcastChannel.instances[0].emitMessage(signal);
    });

    expect(MockBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith(signal);
    expect(listener).toHaveBeenCalledWith(signal);
    expect(result.current.lastBroadcastMessage).toBeNull();
  });

  it('applies durable messages locally without forwarding them as protocol traffic', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });
    const protocolListener = jest.fn();

    result.current.subscribeProtocolMessages(protocolListener);
    act(() => {
      result.current.postDurableMessage(message);
    });

    const signal = MockBroadcastChannel.instances[0].postMessage.mock.calls[0][0] as {
      type: string;
      payload: Uint8Array;
    };

    expect(signal.type).toBe('durable-message');

    act(() => {
      MockBroadcastChannel.instances[0].emitMessage(signal);
    });

    expect(result.current.lastBroadcastMessage).toBeInstanceOf(messages.Message);
    expect(protocolListener).not.toHaveBeenCalled();
  });

  it('closes the previous channel when the channel name changes', () => {
    const { result, rerender } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });
    const encoded = messages.Message.encode(message).finish();

    act(() => {
      MockBroadcastChannel.instances[0].emitMessage(encoded);
    });
    expect(result.current.lastBroadcastMessage).not.toBeNull();

    rerender({ name: 'workspace:B' });

    const [first, second] = MockBroadcastChannel.instances;

    expect(MockBroadcastChannel.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(result.current.lastBroadcastMessage).toBeNull();
  });

  // Reproduces the workspace-switch bug: the closed flag set during the old
  // channel's cleanup must not leak into the replacement channel, otherwise
  // every cross-tab broadcast after a workspace switch is silently dropped.
  it('keeps posting messages after switching to a new channel', () => {
    const { result, rerender } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    act(() => {
      result.current.postMessage(message);
    });

    rerender({ name: 'workspace:B' });

    act(() => {
      result.current.postMessage(message);
    });

    const [first, second] = MockBroadcastChannel.instances;

    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(second.postMessage).toHaveBeenCalledTimes(1);
  });

  it('posts a delayed outbox notification on the workspace channel captured before a switch', () => {
    const { result, rerender } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });
    const postWorkspaceAOutboxReady = result.current.postOutboxReady;

    rerender({ name: 'workspace:B' });

    act(() => {
      postWorkspaceAOutboxReady('A', 'object-1');
    });

    const [workspaceA, workspaceB, delayedWorkspaceA] = MockBroadcastChannel.instances;
    const signal = {
      type: 'outbox-ready',
      workspaceId: 'A',
      objectId: 'object-1',
    };

    expect(workspaceA.closed).toBe(true);
    expect(workspaceB.postMessage).not.toHaveBeenCalledWith(signal);
    expect(delayedWorkspaceA.name).toBe('workspace:A');
    expect(delayedWorkspaceA.postMessage).toHaveBeenCalledWith(signal);
    expect(delayedWorkspaceA.closed).toBe(true);
  });

  it('keeps postMessage referentially stable across channel switches and sends', () => {
    const { result, rerender } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    const initialPostMessage = result.current.postMessage;
    const initialSubscribe = result.current.subscribeProtocolMessages;

    act(() => {
      result.current.postMessage(message);
    });

    rerender({ name: 'workspace:B' });

    expect(result.current.postMessage).toBe(initialPostMessage);
    expect(result.current.subscribeProtocolMessages).toBe(initialSubscribe);
  });

  it('drops sends without throwing after the channel is closed underneath', () => {
    const { result } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    MockBroadcastChannel.instances[0].close();

    expect(() => {
      act(() => {
        result.current.postMessage(message);
      });
    }).not.toThrow();
  });
});
