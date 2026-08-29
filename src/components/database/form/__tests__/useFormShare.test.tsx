import { act, renderHook, waitFor } from '@testing-library/react';

import { ERROR_CODE } from '@/application/constants';
import { FormShareInfo } from '@/application/services/js-services/http';

import { resetFormShareMutationOutboxForTesting, useFormShare } from '../useFormShare';

const mockGetFormShare = jest.fn();
const mockMintFormShare = jest.fn();
const mockPatchFormShare = jest.fn();
let mockViewId = 'view-a';
let mockPrincipalId = 'user-a';

jest.mock('@/application/database-yjs', () => ({
  useDatabase: () => ({ get: () => 'database-id' }),
  useDatabaseViewId: () => mockViewId,
}));

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceIdOptional: () => 'workspace-id',
}));

jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => mockPrincipalId,
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
    resetFormShareMutationOutboxForTesting();
    jest.clearAllMocks();
    mockViewId = 'view-a';
    mockPrincipalId = 'user-a';
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

  it('canonicalizes concurrent providers into one serialized mutation lane', async () => {
    const firstPatch = deferred<FormShareInfo>();
    const secondPatch = deferred<FormShareInfo>();

    mockPatchFormShare.mockReturnValueOnce(firstPatch.promise).mockReturnValueOnce(secondPatch.promise);
    const { result } = renderHook(() => [useFormShare(), useFormShare()] as const);

    await waitFor(() => {
      expect(result.current[0].info?.token).toBe('token-view-a');
      expect(result.current[1].info?.token).toBe('token-view-a');
    });

    let publicMutation!: Promise<void>;
    let closedMutation!: Promise<void>;

    act(() => {
      publicMutation = result.current[0].setTier('public');
    });

    expect(result.current[0].info).toMatchObject({ tier: 'public', anonymous: true });
    expect(result.current[1].info).toMatchObject({ tier: 'public', anonymous: true });

    act(() => {
      closedMutation = result.current[1].setTier('closed');
    });

    expect(result.current[0].info).toMatchObject({ tier: 'closed', anonymous: true });
    expect(result.current[1].info).toMatchObject({ tier: 'closed', anonymous: true });

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

    expect(result.current[0].info).toMatchObject({ tier: 'closed', anonymous: true });
    expect(result.current[1].info).toMatchObject({ tier: 'closed', anonymous: true });
  });

  it('settles a concurrent provider when its own bootstrap is still delayed', async () => {
    const delayedBootstrap = deferred<FormShareInfo>();

    mockGetFormShare.mockResolvedValueOnce(shareInfo('view-a')).mockReturnValueOnce(delayedBootstrap.promise);
    const { result } = renderHook(() => [useFormShare(), useFormShare()] as const);

    await waitFor(() => {
      expect(result.current[0].info?.token).toBe('token-view-a');
      expect(result.current[1].info?.token).toBe('token-view-a');
      expect(result.current[1].isLoading).toBe(false);
    });
    expect(mockGetFormShare).toHaveBeenCalledTimes(2);

    await act(async () => {
      delayedBootstrap.resolve(shareInfo('view-a'));
      await delayedBootstrap.promise;
    });
  });

  it('does not let a concurrent provider stale bootstrap replace a newer mutation', async () => {
    const delayedBootstrap = deferred<FormShareInfo>();

    mockGetFormShare.mockResolvedValueOnce(shareInfo('view-a')).mockReturnValueOnce(delayedBootstrap.promise);
    mockPatchFormShare.mockResolvedValueOnce(shareInfo('view-a', { tier: 'public', anonymous: true }));
    const { result } = renderHook(() => [useFormShare(), useFormShare()] as const);

    await waitFor(() => expect(result.current[0].info?.token).toBe('token-view-a'));
    await act(async () => {
      await result.current[0].setTier('public');
    });

    expect(result.current[0].info).toMatchObject({ tier: 'public', anonymous: true });
    expect(result.current[1].info).toMatchObject({ tier: 'public', anonymous: true });

    await act(async () => {
      delayedBootstrap.resolve(shareInfo('view-a'));
      await delayedBootstrap.promise;
    });

    await waitFor(() => expect(result.current[1].isLoading).toBe(false));
    expect(result.current[0].info).toMatchObject({ tier: 'public', anonymous: true });
    expect(result.current[1].info).toMatchObject({ tier: 'public', anonymous: true });
  });

  it('does not let a delayed stale successful bootstrap replace a newer provider observation', async () => {
    const delayedBootstrap = deferred<FormShareInfo>();
    const currentShare = shareInfo('view-a', { tier: 'public', anonymous: true });

    mockGetFormShare.mockResolvedValueOnce(currentShare).mockReturnValueOnce(delayedBootstrap.promise);
    const { result } = renderHook(() => [useFormShare(), useFormShare()] as const);

    await waitFor(() => {
      expect(result.current[0].info).toMatchObject({ tier: 'public', anonymous: true });
      expect(result.current[1].info).toMatchObject({ tier: 'public', anonymous: true });
    });

    await act(async () => {
      delayedBootstrap.resolve(shareInfo('view-a'));
      await delayedBootstrap.promise;
    });

    await waitFor(() => expect(result.current[1].isLoading).toBe(false));
    expect(result.current[0].info).toMatchObject({ tier: 'public', anonymous: true });
    expect(result.current[1].info).toMatchObject({ tier: 'public', anonymous: true });
  });

  it('preserves a token minted while a concurrent read-only GET was still empty', async () => {
    const delayedReadOnlyGet = deferred<FormShareInfo | null>();
    const minted = shareInfo('view-a');

    mockGetFormShare.mockResolvedValueOnce(null).mockReturnValueOnce(delayedReadOnlyGet.promise);
    mockMintFormShare.mockResolvedValueOnce(minted);
    const { result } = renderHook(() => [useFormShare(), useFormShare({ canUpdateSettings: false })] as const);

    await waitFor(() => expect(result.current[0].info?.token).toBe('token-view-a'));

    await act(async () => {
      delayedReadOnlyGet.resolve(null);
      await delayedReadOnlyGet.promise;
    });

    await waitFor(() => expect(result.current[1].isLoading).toBe(false));
    expect(result.current[0].info?.token).toBe('token-view-a');
    expect(result.current[1].info?.token).toBe('token-view-a');
    expect(mockMintFormShare).toHaveBeenCalledTimes(1);
  });

  it('retains a failed mutation and retries the same final intent', async () => {
    mockPatchFormShare
      .mockRejectedValueOnce({ message: 'Network unavailable' })
      .mockResolvedValueOnce(shareInfo('view-a', { tier: 'public', anonymous: true }));
    const { result } = renderHook(() => useFormShare());

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));
    await act(async () => {
      await result.current.setTier('public');
    });

    expect(result.current.info).toMatchObject({ tier: 'workspace', anonymous: false });
    expect(result.current.error).toBe('Network unavailable');

    act(() => result.current.retryMutation());

    await waitFor(() => expect(mockPatchFormShare).toHaveBeenCalledTimes(2));
    expect(mockPatchFormShare).toHaveBeenLastCalledWith('workspace-id', 'database-id', 'view-a', {
      tier: 'public',
    });
    await waitFor(() => expect(result.current.info).toMatchObject({ tier: 'public', anonymous: true }));
    expect(result.current.error).toBeNull();
  });

  it('replays the latest queued intent after an in-flight mutation fails across unmount', async () => {
    const firstPatch = deferred<FormShareInfo>();

    mockPatchFormShare
      .mockReturnValueOnce(firstPatch.promise)
      .mockResolvedValueOnce(shareInfo('view-a', { tier: 'closed', anonymous: true }));
    const mounted = renderHook(() => useFormShare());

    await waitFor(() => expect(mounted.result.current.info?.token).toBe('token-view-a'));

    let publicMutation!: Promise<void>;
    let closedMutation!: Promise<void>;

    act(() => {
      publicMutation = mounted.result.current.setTier('public');
      closedMutation = mounted.result.current.setTier('closed');
    });
    mounted.unmount();

    await act(async () => {
      firstPatch.reject({ message: 'Offline during navigation' });
      await Promise.all([publicMutation, closedMutation]);
    });

    const remounted = renderHook(() => useFormShare());

    await waitFor(() => expect(mockPatchFormShare).toHaveBeenCalledTimes(2));
    expect(mockPatchFormShare).toHaveBeenLastCalledWith('workspace-id', 'database-id', 'view-a', {
      tier: 'closed',
    });
    await waitFor(() => expect(remounted.result.current.info).toMatchObject({ tier: 'closed', anonymous: true }));
    expect(remounted.result.current.error).toBeNull();
  });

  it('does not adopt a previous account retained mutation after an account switch', async () => {
    mockPatchFormShare.mockRejectedValueOnce({ message: 'Offline before logout' });
    const accountA = renderHook(() => useFormShare());

    await waitFor(() => expect(accountA.result.current.info?.token).toBe('token-view-a'));
    await act(async () => {
      await accountA.result.current.setTier('public');
    });
    expect(mockPatchFormShare).toHaveBeenCalledTimes(1);
    accountA.unmount();

    mockPrincipalId = 'user-b';
    const accountB = renderHook(() => useFormShare());

    await waitFor(() => expect(accountB.result.current.info?.token).toBe('token-view-a'));
    await act(async () => flushMicrotasks());
    expect(mockPatchFormShare).toHaveBeenCalledTimes(1);
    expect(accountB.result.current.info).toMatchObject({ tier: 'workspace', anonymous: false });
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

  it('loads an active link read-only while blocking every share mutation', async () => {
    const { result } = renderHook(() => useFormShare({ canUpdateSettings: false }));

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));
    expect(result.current.canUpdateSettings).toBe(false);

    await act(async () => {
      await result.current.setTier('closed');
      await result.current.setAnonymous(true);
      await result.current.setSubmissionAccess('none');
      result.current.retryMutation();
    });

    expect(mockPatchFormShare).not.toHaveBeenCalled();
    expect(mockMintFormShare).not.toHaveBeenCalled();
    expect(result.current.info).toMatchObject({ tier: 'workspace', anonymous: false });
  });

  it('does not mint a missing link for a read-only viewer', async () => {
    mockGetFormShare.mockResolvedValue(null);
    const { result } = renderHook(() => useFormShare({ canUpdateSettings: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.info).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockMintFormShare).not.toHaveBeenCalled();
    expect(mockPatchFormShare).not.toHaveBeenCalled();
  });

  it('retries a missing read-only link with GET only and adopts a link created by an editor', async () => {
    mockGetFormShare.mockResolvedValueOnce(null).mockResolvedValueOnce(shareInfo('view-a'));
    const { result } = renderHook(() => useFormShare({ canUpdateSettings: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.info).toBeNull();

    act(() => result.current.retryBootstrap());

    await waitFor(() => expect(result.current.info?.token).toBe('token-view-a'));
    expect(mockGetFormShare).toHaveBeenCalledTimes(2);
    expect(mockMintFormShare).not.toHaveBeenCalled();
    expect(mockPatchFormShare).not.toHaveBeenCalled();
  });

  it('clears a stale read-only link when a retry confirms it was revoked externally', async () => {
    mockGetFormShare
      .mockResolvedValueOnce(shareInfo('view-a'))
      .mockResolvedValueOnce(shareInfo('view-a'))
      .mockResolvedValueOnce(null);
    const { result } = renderHook(
      () => [useFormShare({ canUpdateSettings: false }), useFormShare({ canUpdateSettings: false })] as const
    );

    await waitFor(() => {
      expect(result.current[0].info?.token).toBe('token-view-a');
      expect(result.current[1].info?.token).toBe('token-view-a');
    });
    act(() => result.current[0].retryBootstrap());

    await waitFor(() => expect(result.current[0].isLoading).toBe(false));
    expect(result.current[0].info).toBeNull();
    expect(result.current[1].info).toBeNull();
    expect(mockGetFormShare).toHaveBeenCalledTimes(3);
    expect(mockMintFormShare).not.toHaveBeenCalled();
  });

  it('hides a retained failed mutation from a later view-only mount', async () => {
    mockPatchFormShare.mockRejectedValueOnce({ message: 'Offline' });
    const editable = renderHook(() => useFormShare());

    await waitFor(() => expect(editable.result.current.info?.token).toBe('token-view-a'));
    await act(async () => {
      await editable.result.current.setTier('public');
    });
    expect(editable.result.current.error).toBe('Offline');
    editable.unmount();

    const viewOnly = renderHook(() => useFormShare({ canUpdateSettings: false }));

    await waitFor(() => expect(viewOnly.result.current.info?.token).toBe('token-view-a'));
    expect(viewOnly.result.current.info).toMatchObject({ tier: 'workspace', anonymous: false });
    expect(viewOnly.result.current.error).toBeNull();
    expect(mockPatchFormShare).toHaveBeenCalledTimes(1);
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
