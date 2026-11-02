import { act, renderHook, waitFor } from '@testing-library/react';

import { checkImage, CheckImageResult } from '@/utils/image';

import { useImageWithRetry } from '../useImageWithRetry';

jest.mock('@/utils/image', () => ({ checkImage: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn() } }));

const mockCheck = jest.mocked(checkImage);
const success = (validatedUrl: string): CheckImageResult => ({ ok: true, status: 200, statusText: 'OK', validatedUrl });
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  jest.clearAllMocks();
  URL.revokeObjectURL = jest.fn();
});
afterAll(() => {
  URL.revokeObjectURL = originalRevoke;
});
afterEach(() => jest.useRealTimers());

it('reports a decoded URL once and resets that notification for a replacement', async () => {
  mockCheck.mockImplementation(async (url) => success(url));
  const onReady = jest.fn();
  const { result, rerender } = renderHook(({ url }) => useImageWithRetry(url, onReady), {
    initialProps: { url: 'https://example.com/first.png' },
  });

  await waitFor(() => expect(result.current.src).toContain('first.png'));
  act(() => {
    result.current.onImageLoaded();
    result.current.onImageLoaded();
  });
  expect(onReady).toHaveBeenCalledTimes(1);
  rerender({ url: 'https://example.com/second.png' });
  await waitFor(() => expect(result.current.src).toContain('second.png'));
  act(() => result.current.onImageLoaded());
  expect(onReady).toHaveBeenCalledTimes(2);
});

it('clearing a URL cancels an in-flight load and ignores its late result', async () => {
  let finish!: (value: CheckImageResult) => void;

  mockCheck.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(({ url }) => useImageWithRetry(url), {
    initialProps: { url: 'https://example.com/old.png' },
  });
  const signal = mockCheck.mock.calls[0][1]?.signal;

  rerender({ url: '' });
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(success('blob:late')));
  expect(result.current.src).toBe('');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
});

it('stops automatic retries at the budget and starts a fresh budget for explicit retry', async () => {
  jest.useFakeTimers();
  mockCheck.mockResolvedValue({ ok: false, status: 500, statusText: 'Unavailable', errorKind: 'server-error' });
  const { result, unmount } = renderHook(() => useImageWithRetry('https://example.com/retry.png'));

  await act(async () => {
    await jest.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(result.current.phase).toBe('failed');
  const attempts = mockCheck.mock.calls.length;

  expect(attempts).toBeGreaterThan(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(mockCheck).toHaveBeenCalledTimes(attempts);
  mockCheck.mockResolvedValue(success('https://example.com/retry.png'));
  await act(async () => result.current.retry());
  act(() => result.current.onImageLoaded());
  expect(result.current.phase).toBe('ready');
  expect(mockCheck).toHaveBeenCalledTimes(attempts + 1);
  unmount();
});

it('releases pending retries when the owner unmounts', async () => {
  jest.useFakeTimers();
  mockCheck.mockResolvedValue({ ok: false, status: 503, statusText: 'Pending', errorKind: 'not-ready' });
  const { unmount } = renderHook(() => useImageWithRetry('https://example.com/pending.png'));

  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  const signal = mockCheck.mock.calls[0][1]?.signal;

  unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(signal?.aborted).toBe(true);
  expect(mockCheck).toHaveBeenCalledTimes(1);
});

it('clears an earlier decode error when the image successfully loads', async () => {
  mockCheck.mockResolvedValue(success('https://example.com/image.png'));
  const onReady = jest.fn();
  const { result } = renderHook(() => useImageWithRetry('https://example.com/image.png', onReady));

  await waitFor(() => expect(result.current.src).toBe('https://example.com/image.png'));
  act(() => result.current.onImageError());
  expect(result.current.phase).toBe('failed');
  act(() => result.current.onImageLoaded());

  expect(result.current.isImageReady).toBe(true);
  expect(result.current.phase).not.toBe('failed');
  expect(result.current.lastError).toBeNull();
  expect(onReady).toHaveBeenCalledTimes(1);
});

it('does not revoke a borrowed preview URL when one of two consumers unmounts', async () => {
  mockCheck.mockResolvedValue(success('blob:shared-preview'));
  const original = renderHook(() => useImageWithRetry('blob:shared-preview'));
  const duplicate = renderHook(() => useImageWithRetry('blob:shared-preview'));

  await waitFor(() => expect(original.result.current.src).toBe('blob:shared-preview'));
  await waitFor(() => expect(duplicate.result.current.src).toBe('blob:shared-preview'));
  original.unmount();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  duplicate.unmount();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it.each([
  { source: 'blob:preview', validated: 'blob:preview', owned: false },
  { source: '/api/file_storage/image.png', validated: 'blob:fetched', owned: true },
])('only releases an owned URL when a cancelled check resolves ($owned)', async ({ source, validated, owned }) => {
  let resolve!: (result: CheckImageResult) => void;

  mockCheck.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { unmount } = renderHook(() => useImageWithRetry(source));

  unmount();
  await act(async () => resolve(success(validated)));
  if (owned) expect(URL.revokeObjectURL).toHaveBeenCalledWith(validated);
  else expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('releases fetched blob URLs on replacement and unmount', async () => {
  mockCheck.mockResolvedValueOnce(success('blob:first')).mockResolvedValueOnce(success('blob:second'));
  const { result, rerender, unmount } = renderHook(({ url }) => useImageWithRetry(url), {
    initialProps: { url: '/api/file_storage/first.png' },
  });

  await waitFor(() => expect(result.current.src).toBe('blob:first'));
  rerender({ url: '/api/file_storage/second.png' });
  await waitFor(() => expect(result.current.src).toBe('blob:second'));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:second');
});
