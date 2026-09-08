import { act, renderHook } from '@testing-library/react';

import { AuthService } from '@/application/services/domains';

import { SERVER_INFO_REFRESH_INTERVAL_MS, useServerInfo } from '../useServerInfo';

jest.mock('@/application/services/domains', () => ({ AuthService: { getServerInfo: jest.fn() } }));

const getServerInfo = jest.mocked(AuthService.getServerInfo);

beforeEach(() => {
  jest.useFakeTimers();
  getServerInfo.mockReset().mockResolvedValue({ enable_page_history: true, version: '0.18.0' });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function tick(milliseconds = 0) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });
}

it('refreshes every five minutes and clears a confirmed snapshot during failed refreshes', async () => {
  const { result, unmount } = renderHook(() => useServerInfo(true, 'server-a'));

  await tick();
  expect(result.current.info?.version).toBe('0.18.0');
  getServerInfo.mockRejectedValueOnce(new Error('offline'));
  await tick(SERVER_INFO_REFRESH_INTERVAL_MS);
  expect(result.current.status).toBe('unavailable');
  expect(result.current.info).toBeUndefined();
  getServerInfo.mockResolvedValue({ enable_page_history: true, version: '0.17.0' });
  await tick(1_000);
  expect(result.current.info?.version).toBe('0.17.0');
  await tick(SERVER_INFO_REFRESH_INTERVAL_MS);
  expect(getServerInfo).toHaveBeenCalledTimes(4);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('revalidates a long-lived tab on focus without overlapping requests', async () => {
  const { unmount } = renderHook(() => useServerInfo(true, 'server-a'));

  await tick();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(getServerInfo).toHaveBeenCalledTimes(1);
  await tick(30_000);
  getServerInfo.mockReturnValue(new Promise(() => undefined));
  act(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  expect(getServerInfo).toHaveBeenCalledTimes(2);
  unmount();
  expect(getServerInfo.mock.calls[1][0]?.aborted).toBe(true);
});

it('ignores superseded server responses and stops on logout', async () => {
  let resolveOld!: (value: Awaited<ReturnType<typeof AuthService.getServerInfo>>) => void;

  getServerInfo.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    })
  );
  const { result, rerender, unmount } = renderHook(({ enabled, url }) => useServerInfo(enabled, url), {
    initialProps: { enabled: true, url: 'server-a' },
  });
  const oldSignal = getServerInfo.mock.calls[0][0];

  rerender({ enabled: true, url: 'server-b' });
  expect(oldSignal?.aborted).toBe(true);
  await tick();
  await act(async () => {
    resolveOld({ enable_page_history: true, version: '0.1.0' });
  });
  expect(result.current.info?.version).toBe('0.18.0');
  rerender({ enabled: false, url: 'server-b' });
  expect(result.current.info).toBeUndefined();
  await tick(SERVER_INFO_REFRESH_INTERVAL_MS);
  expect(getServerInfo).toHaveBeenCalledTimes(2);
  unmount();
});

it('keeps older responses without version metadata usable and retries unsupported endpoints slowly', async () => {
  getServerInfo.mockRejectedValueOnce({ code: 404 });
  const { result, unmount } = renderHook(() => useServerInfo(true, 'server-a'));

  await tick();
  await tick(30_000);
  expect(getServerInfo).toHaveBeenCalledTimes(1);
  getServerInfo.mockResolvedValue({ enable_page_history: true });
  await tick(SERVER_INFO_REFRESH_INTERVAL_MS - 30_000);
  expect(result.current.status).toBe('available');
  expect(result.current.info?.version).toBeUndefined();
  unmount();
});
