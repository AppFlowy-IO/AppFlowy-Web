import { act, renderHook, waitFor } from '@testing-library/react';

import { openPDF } from '../pdf-engine';
import { usePDFDocument } from '../usePDFDocument';

jest.mock('../pdf-engine', () => ({ openPDF: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function loadingTask() {
  const pending = deferred<object>();
  const task = {
    promise: pending.promise,
    destroy: jest.fn().mockResolvedValue(undefined),
    onPassword: undefined as undefined | ((callback: (value: string) => void, reason: number) => void),
  };

  return { ...pending, task };
}

afterEach(() => jest.clearAllMocks());
it('does not load an inactive tab, and releases its worker when deactivated (Flutter preview parity)', async () => {
  const { task } = loadingTask();

  (openPDF as jest.Mock).mockReturnValue(task);
  const { rerender, unmount } = renderHook(({ active }) => usePDFDocument('/pdf', active), {
    initialProps: { active: false },
  });

  expect(openPDF).not.toHaveBeenCalled();
  rerender({ active: true });
  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(1));
  rerender({ active: false });
  expect(task.destroy).toHaveBeenCalledTimes(1);
  unmount();
});
it('ignores stale completions after replacement and destroys both owned tasks', async () => {
  const first = loadingTask();
  const second = loadingTask();

  (openPDF as jest.Mock).mockReturnValueOnce(first.task).mockReturnValueOnce(second.task);
  const { result, rerender, unmount } = renderHook(({ url }) => usePDFDocument(url), {
    initialProps: { url: '/first' },
  });

  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(1));
  rerender({ url: '/second' });
  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(2));
  await act(async () => {
    second.resolve({ numPages: 2 });
    first.resolve({ numPages: 1 });
  });
  expect(result.current.state).toEqual({ status: 'ready', document: { numPages: 2 } });
  expect(first.task.destroy).toHaveBeenCalledTimes(1);
  unmount();
  expect(second.task.destroy).toHaveBeenCalledTimes(1);
});

it('falls back immediately after an external CORS failure and keeps the fallback loaded on rerender', async () => {
  const direct = loadingTask();
  const proxy = loadingTask();
  const url = 'https://files.example.com/book.pdf';

  (openPDF as jest.Mock).mockReturnValueOnce(direct.task).mockReturnValueOnce(proxy.task);
  const { result, rerender, unmount } = renderHook(() => usePDFDocument(url));

  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(1));
  await act(async () => direct.reject(Object.assign(new Error('Failed to fetch'), { name: 'UnknownErrorException' })));
  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(2));
  expect(openPDF).toHaveBeenLastCalledWith(`/api/pdf-proxy?url=${encodeURIComponent(url)}`, undefined);
  expect(direct.task.destroy).toHaveBeenCalledTimes(1);
  await act(async () => proxy.resolve({ numPages: 75 }));
  rerender();
  expect(result.current.state.status).toBe('ready');
  expect(openPDF).toHaveBeenCalledTimes(2);
  unmount();
  expect(proxy.task.destroy).toHaveBeenCalledTimes(1);
});
it('handles wrong-password challenges on the same loading task without redownloading', async () => {
  const { task, resolve } = loadingTask();
  const updatePassword = jest.fn();

  (openPDF as jest.Mock).mockReturnValue(task);
  const { result } = renderHook(() => usePDFDocument('/locked'));

  await waitFor(() => expect(task.onPassword).toBeDefined());
  act(() => task.onPassword!(updatePassword, 1));
  expect(result.current.state).toEqual({ status: 'password', incorrect: false });
  act(() => result.current.unlock('wrong'));
  expect(updatePassword).toHaveBeenCalledWith('wrong');
  act(() => task.onPassword!(updatePassword, 2));
  expect(result.current.state).toEqual({ status: 'password', incorrect: true });
  act(() => result.current.unlock('123'));
  await act(async () => resolve({ numPages: 3 }));
  expect(result.current.state.status).toBe('ready');
  expect(openPDF).toHaveBeenCalledTimes(1);
});
it('offers an explicit retry after an invalid PDF without an unbounded retry loop', async () => {
  const first = loadingTask();
  const second = loadingTask();

  (openPDF as jest.Mock).mockReturnValueOnce(first.task).mockReturnValueOnce(second.task);
  const { result } = renderHook(() => usePDFDocument('/invalid'));

  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(1));
  await act(async () => first.reject(new Error('Invalid PDF')));
  expect(result.current.state.status).toBe('error');
  act(() => result.current.retry());
  await waitFor(() => expect(openPDF).toHaveBeenCalledTimes(2));
  expect(first.task.destroy).toHaveBeenCalledTimes(1);
});

it('backs off transient failures and cancels the retry when the viewer leaves the active tab', async () => {
  jest.useFakeTimers();
  const first = loadingTask();
  const second = loadingTask();

  (openPDF as jest.Mock).mockReturnValueOnce(first.task).mockReturnValueOnce(second.task);
  const { rerender } = renderHook(({ active }) => usePDFDocument('/temporary', active), {
    initialProps: { active: true },
  });

  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => first.reject(Object.assign(new Error('Unavailable'), { status: 503 })));
  expect(first.task.destroy).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(2999);
  });
  expect(openPDF).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(openPDF).toHaveBeenCalledTimes(2);
  await act(async () => second.reject(Object.assign(new Error('Unavailable'), { status: 503 })));
  rerender({ active: false });
  await act(async () => {
    jest.runAllTimers();
  });
  expect(openPDF).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});
