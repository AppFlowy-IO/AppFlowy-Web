import { act, renderHook } from '@testing-library/react';

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

  emitMessage(data: ArrayBuffer | Uint8Array) {
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

  it('closes the previous channel when the channel name changes', () => {
    const { rerender } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    rerender({ name: 'workspace:B' });

    const [first, second] = MockBroadcastChannel.instances;

    expect(MockBroadcastChannel.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
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

  it('keeps postMessage referentially stable across channel switches and sends', () => {
    const { result, rerender } = renderHook(({ name }) => useBroadcastChannel(name), {
      initialProps: { name: 'workspace:A' },
    });

    const initialPostMessage = result.current.postMessage;

    act(() => {
      result.current.postMessage(message);
    });

    rerender({ name: 'workspace:B' });

    expect(result.current.postMessage).toBe(initialPostMessage);
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
