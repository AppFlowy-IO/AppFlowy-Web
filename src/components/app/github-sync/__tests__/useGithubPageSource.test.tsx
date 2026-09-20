import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { getPageSource, GithubPageSource } from '@/application/services/domains/github-sync';
import { AFConfigContext } from '@/components/main/app.hooks';

import { useGithubPageSource } from '../useGithubPageSource';

jest.mock('@/application/services/domains/github-sync', () => ({ getPageSource: jest.fn() }));
jest.mock('@/components/main/app.hooks', () => ({
  AFConfigContext: jest.requireActual<typeof import('react')>('react').createContext(undefined),
}));

const fetchSource = getPageSource as jest.MockedFunction<typeof getPageSource>;
const managed: GithubPageSource = {
  binding_id: 'binding',
  view_id: 'view',
  read_only: true,
  status: 'synced',
  paused: false,
  path: 'docs/AUTHENTICATION.md',
  lifecycle: 'active',
  source_url: 'https://github.com/example/docs/blob/main/docs/AUTHENTICATION.md',
  source_commit_sha: 'abc123',
  last_error: null,
};
let account = 'user-a';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AFConfigContext.Provider
      value={{
        isAuthenticated: true,
        authenticatedUserId: account,
        updateCurrentUser: jest.fn(),
        openLoginModal: jest.fn(),
      }}
    >
      {children}
    </AFConfigContext.Provider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  account = 'user-a';
});
afterEach(() => jest.useRealTimers());

test('deduplicates selected page and menu consumers without probing inactive views', async () => {
  fetchSource.mockResolvedValue(managed);
  const active = renderHook(
    () => {
      const page = useGithubPageSource('workspace', 'view');
      const menu = useGithubPageSource('workspace', 'view');
      const closed = useGithubPageSource('workspace', 'other', false);

      return { page, menu, closed };
    },
    { wrapper: Wrapper }
  );

  await waitFor(() => expect(active.result.current.page.managed).toBe(true));
  expect(active.result.current.menu.source).toEqual(managed);
  expect(active.result.current.closed.managed).toBe(false);
  expect(fetchSource).toHaveBeenCalledTimes(1);
  active.unmount();
});

test('retains managed ownership on refresh failures and inconsistent null responses', async () => {
  jest.useFakeTimers();
  fetchSource.mockResolvedValueOnce(managed).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
  const active = renderHook(() => useGithubPageSource('workspace', 'view'), { wrapper: Wrapper });

  await act(async () => {
    await Promise.resolve();
  });
  expect(active.result.current.managed).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(active.result.current.error).toBe(true);
  expect(active.result.current.managed).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  expect(active.result.current.managed).toBe(true);
  active.unmount();
});

test('aborts the previous workspace request and ignores a late response', async () => {
  let finishOld: ((value: GithubPageSource | null) => void) | undefined;

  fetchSource
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockResolvedValueOnce(null);
  const active = renderHook(({ workspace }) => useGithubPageSource(workspace, 'view'), {
    wrapper: Wrapper,
    initialProps: { workspace: 'first' },
  });
  const signal = fetchSource.mock.calls[0][2];

  active.rerender({ workspace: 'second' });
  expect(signal?.aborted).toBe(true);
  await waitFor(() => expect(active.result.current.loading).toBe(false));
  await act(async () => finishOld?.(managed));
  expect(active.result.current.source).toBeNull();
  expect(active.result.current.managed).toBe(false);
  active.unmount();
});

test('clears ownership on account changes and releases an unmounted request', async () => {
  fetchSource.mockResolvedValueOnce(managed).mockImplementationOnce(() => new Promise(() => undefined));
  const active = renderHook(() => useGithubPageSource('workspace', 'view'), { wrapper: Wrapper });

  await waitFor(() => expect(active.result.current.managed).toBe(true));
  account = 'user-b';
  active.rerender();
  expect(active.result.current.source).toBeNull();
  expect(active.result.current.loading).toBe(true);
  expect(fetchSource).toHaveBeenCalledTimes(2);
  const signal = fetchSource.mock.calls[1][2];

  active.unmount();
  expect(signal?.aborted).toBe(true);
});

test('ordinary pages and an unavailable older endpoint retain canonical permissions', async () => {
  fetchSource.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('not supported'));
  const active = renderHook(({ view }) => useGithubPageSource('workspace', view), {
    wrapper: Wrapper,
    initialProps: { view: 'manual' },
  });

  await waitFor(() => expect(active.result.current.loading).toBe(false));
  expect(active.result.current.managed).toBe(false);
  active.rerender({ view: 'legacy' });
  await waitFor(() => expect(active.result.current.error).toBe(true));
  expect(active.result.current.managed).toBe(false);
  expect(active.result.current.loading).toBe(false);
  active.unmount();
});
