import { act, renderHook } from '@testing-library/react';

import { McpApiError } from '@/application/services/domains/mcp';
import { notify } from '@/components/_shared/notify';

import { useMcpAction, useMcpResource } from '../useMcpRequest';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn(), error: jest.fn() } }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, resolve, reject };
}

/**
 * A load whose calls answer only when the test says so, and which ignores its AbortSignal like a
 * response already on its way: the hook alone must drop what it no longer wants.
 */
function controlledLoad<T>() {
  const calls: { signal: AbortSignal; answer: Deferred<T> }[] = [];
  const load = jest.fn((signal: AbortSignal) => {
    const answer = deferred<T>();

    calls.push({ signal, answer });
    return answer.promise;
  });

  return { load, calls };
}

/** Settles `answer` and lets the hook's handlers run. */
async function settle(run: () => void) {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}

describe('useMcpResource', () => {
  it('keeps the newest load when an earlier one answers after a reload', async () => {
    const { load, calls } = controlledLoad<string>();
    const { result } = renderHook(() => useMcpResource(load));

    expect(result.current.loading).toBe(true);
    act(() => {
      void result.current.reload();
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);

    await settle(() => calls[1].answer.resolve('second'));
    expect(result.current.data).toBe('second');
    expect(result.current.loading).toBe(false);

    await settle(() => calls[0].answer.resolve('first'));
    expect(result.current.data).toBe('second');
    expect(result.current.loading).toBe(false);
  });

  it('ignores a superseded load that fails late', async () => {
    const { load, calls } = controlledLoad<string>();
    const { result } = renderHook(() => useMcpResource(load));

    act(() => {
      void result.current.reload();
    });
    await settle(() => calls[1].answer.resolve('second'));
    await settle(() => calls[0].answer.reject(new McpApiError({ status: 500 })));

    expect(result.current.failed).toBe(false);
    expect(result.current.data).toBe('second');
  });

  it('lets an action’s update win over a load answered before the action took effect', async () => {
    const { load, calls } = controlledLoad<string[]>();
    const { result } = renderHook(() => useMcpResource(load));

    await settle(() => calls[0].answer.resolve(['a', 'b']));
    act(() => {
      void result.current.reload();
    });
    expect(result.current.loading).toBe(true);

    act(() => result.current.update((current) => current?.filter((item) => item !== 'a')));
    expect(calls[1].signal.aborted).toBe(true);
    expect(result.current.data).toEqual(['b']);
    expect(result.current.loading).toBe(false);

    // The reload was answered before the action: it still lists 'a'.
    await settle(() => calls[1].answer.resolve(['a', 'b']));
    expect(result.current.data).toEqual(['b']);
    expect(result.current.loading).toBe(false);
  });

  it('drops a load answered after it was disabled', async () => {
    const { load, calls } = controlledLoad<string>();
    const { result, rerender } = renderHook(({ enabled }) => useMcpResource(load, enabled), {
      initialProps: { enabled: true },
    });

    rerender({ enabled: false });
    expect(calls[0].signal.aborted).toBe(true);

    await settle(() => calls[0].answer.resolve('late'));
    expect(result.current.data).toBeUndefined();
    expect(result.current.failed).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('aborts the load in flight when unmounted', () => {
    const { load, calls } = controlledLoad<string>();
    const { unmount } = renderHook(() => useMcpResource(load));

    unmount();
    expect(calls[0].signal.aborted).toBe(true);
  });
});

describe('useMcpAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs one action at a time', async () => {
    const answer = deferred<string>();
    const first = jest.fn(() => answer.promise);
    const second = jest.fn(() => Promise.resolve('second'));
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useMcpAction<string>());
    let firstRun!: Promise<boolean>;
    let secondRun!: Promise<boolean>;

    act(() => {
      firstRun = result.current.run('first', first, onSuccess);
    });
    expect(result.current.pending).toBe('first');
    act(() => {
      secondRun = result.current.run('second', second, onSuccess);
    });

    await expect(secondRun).resolves.toBe(false);
    expect(second).not.toHaveBeenCalled();

    await settle(() => answer.resolve('first'));
    await expect(firstRun).resolves.toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('first');
    expect(result.current.pending).toBeUndefined();
  });

  it('reports a failure with a toast and onError', async () => {
    const error = new McpApiError({ status: 429, reason: 'rate_limited' });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result } = renderHook(() => useMcpAction<string>());
    let run!: Promise<boolean>;

    await act(async () => {
      run = result.current.run('revoke', () => Promise.reject(error), onSuccess, onError);
      await run;
    });

    await expect(run).resolves.toBe(false);
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['succeeds', (answer: Deferred<string>) => answer.resolve('done')],
    ['fails', (answer: Deferred<string>) => answer.reject(new McpApiError({ status: 500 }))],
  ])('reports nothing when unmounted before the request %s', async (_case, finish) => {
    const answer = deferred<string>();
    let signal: AbortSignal | undefined;
    const request = jest.fn((requestSignal: AbortSignal) => {
      signal = requestSignal;
      return answer.promise;
    });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const { result, unmount } = renderHook(() => useMcpAction<string>());
    let run!: Promise<boolean>;

    act(() => {
      run = result.current.run('disconnect', request, onSuccess, onError);
    });
    unmount();
    expect(signal?.aborted).toBe(true);

    finish(answer);
    await expect(run).resolves.toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });
});
