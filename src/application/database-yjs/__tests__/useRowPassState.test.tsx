import { act, renderHook } from '@testing-library/react';

import { RowPassState, useRowPassState } from '@/application/database-yjs/context';

function createRowPassStore(initial: RowPassState) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getRowPassState: () => state,
    subscribeToRowPassState: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    set: (next: RowPassState) => {
      state = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

describe('useRowPassState', () => {
  it('reads the store of a database that serves one, and re-renders the caller when it changes', () => {
    const store = createRowPassStore({ blobPrefetchComplete: false, seedsReady: false });
    // Plain fields of an older snapshot never win over the store.
    const context = { ...store, blobPrefetchComplete: true, seedsReady: true };
    const { result, unmount } = renderHook(() => useRowPassState(context));

    expect(result.current).toEqual({ blobPrefetchComplete: false, seedsReady: false });
    act(() => store.set({ blobPrefetchComplete: false, seedsReady: true }));
    expect(result.current).toEqual({ blobPrefetchComplete: false, seedsReady: true });

    unmount();
    expect(store.listenerCount()).toBe(0);
  });

  it('reads the plain fields of a provider without a store', () => {
    const { result, rerender } = renderHook(
      ({ seedsReady }: { seedsReady?: boolean }) => useRowPassState({ blobPrefetchComplete: undefined, seedsReady }),
      { initialProps: { seedsReady: false } }
    );

    expect(result.current).toEqual({ blobPrefetchComplete: false, seedsReady: false });
    const before = result.current;

    rerender({ seedsReady: false });
    expect(result.current).toBe(before);
    rerender({ seedsReady: true });
    expect(result.current).toEqual({ blobPrefetchComplete: false, seedsReady: true });
  });

  it('neither subscribes nor reads for a caller that is not enabled, until it is', () => {
    const store = createRowPassStore({ blobPrefetchComplete: true, seedsReady: true });
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useRowPassState(store, enabled), {
      initialProps: { enabled: false },
    });

    expect(result.current).toEqual({ blobPrefetchComplete: false, seedsReady: false });
    expect(store.subscribeToRowPassState).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current).toEqual({ blobPrefetchComplete: true, seedsReady: true });
    expect(store.listenerCount()).toBe(1);
  });
});
