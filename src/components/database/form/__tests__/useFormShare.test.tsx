import { act, renderHook, waitFor } from '@testing-library/react';

import { ERROR_CODE } from '@/application/constants';
import { FormShareInfo } from '@/application/services/js-services/http';

import { useFormShare } from '../useFormShare';

const mockGetFormShare = jest.fn();
const mockMintFormShare = jest.fn();
const mockPatchFormShare = jest.fn();
let mockViewId = 'view-a';

jest.mock('@/application/database-yjs', () => ({
  useDatabase: () => ({ get: () => 'database-id' }),
  useDatabaseViewId: () => mockViewId,
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: () => 'workspace-id',
}));

jest.mock('@/application/services/js-services/http', () => ({
  getFormShare: (...args: unknown[]) => mockGetFormShare(...args),
  mintFormShare: (...args: unknown[]) => mockMintFormShare(...args),
  patchFormShare: (...args: unknown[]) => mockPatchFormShare(...args),
}));

function shareInfo(viewId: string, overrides: Partial<FormShareInfo> = {}): FormShareInfo {
  return {
    token: `token-${viewId}`,
    tier: 'workspace',
    anonymous: false,
    submission_access: 'none',
    share_url: `https://appflowy.test/form/token-${viewId}`,
    created_at: '2026-08-28T00:00:00Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

describe('useFormShare mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockViewId = 'view-a';
    mockGetFormShare.mockImplementation((_workspaceId: string, _databaseId: string, viewId: string) =>
      Promise.resolve(shareInfo(viewId))
    );
  });

  it('queues a rapid later tier choice instead of dropping it', async () => {
    const firstPatch = deferred<FormShareInfo>();
    const secondPatch = deferred<FormShareInfo>();

    mockPatchFormShare.mockReturnValueOnce(firstPatch.promise).mockReturnValueOnce(secondPatch.promise);

    const { result } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));

    let publicMutation!: Promise<void>;
    let closedMutation!: Promise<void>;

    act(() => {
      publicMutation = result.current.setTier('public');
      closedMutation = result.current.setTier('closed');
    });

    expect(result.current.info).toMatchObject({ tier: 'closed', anonymous: true });
    expect(mockPatchFormShare).toHaveBeenCalledTimes(1);
    expect(mockPatchFormShare).toHaveBeenNthCalledWith(1, 'workspace-id', 'database-id', 'view-a', { tier: 'public' });

    await act(async () => {
      firstPatch.resolve(shareInfo('view-a', { tier: 'public', anonymous: true }));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPatchFormShare).toHaveBeenCalledTimes(2));
    expect(mockPatchFormShare).toHaveBeenNthCalledWith(2, 'workspace-id', 'database-id', 'view-a', { tier: 'closed' });

    await act(async () => {
      secondPatch.resolve(shareInfo('view-a', { tier: 'closed', anonymous: true }));
      await Promise.all([publicMutation, closedMutation]);
    });

    expect(result.current.info).toMatchObject({ tier: 'closed', anonymous: true });
  });

  it('patches only the changed field and adopts unrelated concurrent server state', async () => {
    mockPatchFormShare.mockResolvedValue(
      shareInfo('view-a', {
        tier: 'closed',
        anonymous: true,
      })
    );
    const { result } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));
    await act(async () => {
      await result.current.setAnonymous(true);
    });

    expect(mockPatchFormShare).toHaveBeenCalledWith('workspace-id', 'database-id', 'view-a', { anonymous: true });
    expect(result.current.info).toMatchObject({ tier: 'closed', anonymous: true });
  });

  it('ignores a late patch response from the previously selected Form view', async () => {
    const viewAPatch = deferred<FormShareInfo>();

    mockPatchFormShare.mockReturnValueOnce(viewAPatch.promise);
    const { result, rerender } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));

    let mutation!: Promise<void>;

    act(() => {
      mutation = result.current.setTier('public');
    });

    mockViewId = 'view-b';
    rerender();

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-b'));

    await act(async () => {
      viewAPatch.resolve(shareInfo('view-a', { tier: 'public', anonymous: true }));
      await mutation;
    });

    expect(result.current.info).toMatchObject({
      token: 'token-view-b',
      tier: 'workspace',
    });
  });

  it('rebootstraps a missing PATCH token and applies the latest queued choice', async () => {
    const recoveryGet = deferred<FormShareInfo | null>();
    const recoveredPatch = deferred<FormShareInfo | null>();
    const replacement = shareInfo('view-a', {
      token: 'replacement-token',
      share_url: 'https://appflowy.test/form/replacement-token',
    });

    mockGetFormShare.mockResolvedValueOnce(shareInfo('view-a')).mockReturnValueOnce(recoveryGet.promise);
    mockMintFormShare.mockResolvedValue(replacement);
    mockPatchFormShare.mockResolvedValueOnce(null).mockReturnValueOnce(recoveredPatch.promise);

    const { result } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));

    let publicMutation!: Promise<void>;
    let closedMutation!: Promise<void>;

    act(() => {
      publicMutation = result.current.setTier('public');
    });
    await waitFor(() => expect(mockGetFormShare).toHaveBeenCalledTimes(2));

    // Queue another choice while the missing-token recovery GET is pending.
    // Recovery must not replace this with the state captured by the first
    // PATCH request.
    act(() => {
      closedMutation = result.current.setTier('closed');
    });

    await act(async () => {
      recoveryGet.resolve(null);
      await flushMicrotasks();
    });

    expect(mockMintFormShare).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockPatchFormShare).toHaveBeenCalledTimes(2));
    expect(mockPatchFormShare).toHaveBeenNthCalledWith(2, 'workspace-id', 'database-id', 'view-a', { tier: 'closed' });

    await act(async () => {
      recoveredPatch.resolve({
        ...replacement,
        tier: 'closed',
        anonymous: true,
      });
      await Promise.all([publicMutation, closedMutation]);
    });

    expect(result.current.info).toMatchObject({
      token: 'replacement-token',
      tier: 'closed',
      anonymous: true,
    });
    expect(result.current.error).toBeNull();
  });

  it('does not mint when reading the existing share fails', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockGetFormShare.mockRejectedValue({ code: 403, message: 'Forbidden' });

    const { result } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.error).toBe('Forbidden'));
    expect(result.current.errorKind).toBe('other');
    expect(mockMintFormShare).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it('surfaces a network failure once and retries only after the user asks', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockGetFormShare
      .mockRejectedValueOnce({ code: -1, message: 'Network unavailable' })
      .mockResolvedValueOnce(shareInfo('view-a'));

    const { result } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.error).toBe('Network unavailable'));
    expect(mockGetFormShare).toHaveBeenCalledTimes(1);

    act(() => result.current.retryBootstrap());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));
    expect(mockGetFormShare).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it('backs off only between view-not-found attempts, with no delay after the final attempt', async () => {
    jest.useFakeTimers();
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    try {
      mockGetFormShare.mockRejectedValue({
        code: ERROR_CODE.RECORD_NOT_FOUND,
        message: 'Form view not found',
      });

      const { result } = renderHook(() => useFormShare());

      await act(flushMicrotasks);
      expect(mockGetFormShare).toHaveBeenCalledTimes(1);

      for (let attempt = 1; attempt < 5; attempt += 1) {
        await act(async () => {
          jest.runOnlyPendingTimers();
          await flushMicrotasks();
        });
      }

      expect(mockGetFormShare).toHaveBeenCalledTimes(5);
      expect(result.current.error).toBe('Form view not found');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      warning.mockRestore();
      debug.mockRestore();
      jest.useRealTimers();
    }
  });
});
