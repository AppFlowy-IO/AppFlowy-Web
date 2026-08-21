import { act, renderHook, waitFor } from '@testing-library/react';

import { useWorkspaceWebSocketLeader } from '../useWorkspaceWebSocketLeader';

interface PendingLockRequest {
  name: string;
  callback: LockGrantedCallback;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

class MockLockManager {
  private held = false;
  private pending: PendingLockRequest[] = [];

  request(name: string, options: LockOptions, callback: LockGrantedCallback): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = { name, callback, signal: options.signal, resolve, reject };

      options.signal?.addEventListener(
        'abort',
        () => {
          const index = this.pending.indexOf(request);

          if (index >= 0) {
            this.pending.splice(index, 1);
            reject(new DOMException('The lock request was aborted', 'AbortError'));
          }
        },
        { once: true }
      );
      this.pending.push(request);
      this.grantNext();
    });
  }

  private grantNext() {
    if (this.held) return;

    const request = this.pending.shift();

    if (!request) return;
    if (request.signal?.aborted) {
      request.reject(new DOMException('The lock request was aborted', 'AbortError'));
      this.grantNext();
      return;
    }

    this.held = true;
    const lock = { name: request.name, mode: 'exclusive' } as Lock;

    void Promise.resolve(request.callback(lock)).then(
      (value) => {
        this.held = false;
        request.resolve(value);
        this.grantNext();
      },
      (error) => {
        this.held = false;
        request.reject(error);
        this.grantNext();
      }
    );
  }
}

describe('useWorkspaceWebSocketLeader', () => {
  const originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, 'locks', originalLocksDescriptor);
    } else {
      delete (navigator as Navigator & { locks?: LockManager }).locks;
    }
  });

  it('allows only one tab to lead and hands ownership to the next waiter', async () => {
    const locks = new MockLockManager();

    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: locks,
    });

    const first = renderHook(() => useWorkspaceWebSocketLeader('workspace-1'));
    const second = renderHook(() => useWorkspaceWebSocketLeader('workspace-1'));

    await waitFor(() => {
      expect(first.result.current).toEqual({ isLeader: true, isCoordinated: true });
    });
    expect(second.result.current).toEqual({ isLeader: false, isCoordinated: true });

    act(() => {
      first.unmount();
    });

    await waitFor(() => {
      expect(second.result.current).toEqual({ isLeader: true, isCoordinated: true });
    });

    second.unmount();
  });

  it('keeps realtime available when Web Locks are unavailable', () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useWorkspaceWebSocketLeader('workspace-1'));

    expect(result.current).toEqual({ isLeader: true, isCoordinated: false });
  });

  it('falls back instead of leaving realtime disabled when lock acquisition fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const locks = {
      request: jest.fn().mockRejectedValue(new Error('lock manager unavailable')),
    } as unknown as LockManager;

    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: locks,
    });

    const { result } = renderHook(() => useWorkspaceWebSocketLeader('workspace-1'));

    await waitFor(() => {
      expect(result.current).toEqual({ isLeader: true, isCoordinated: false });
    });
  });
});
