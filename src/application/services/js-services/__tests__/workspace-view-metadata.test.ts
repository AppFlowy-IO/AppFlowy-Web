import { EventType, on } from '@/application/session/event';
import { getTokenParsed } from '@/application/session/token';
import { View, ViewLayout } from '@/application/types';

import {
  clearWorkspaceViewMetadataCache,
  captureWorkspaceViewMetadataAccessToken,
  getCachedWorkspaceViewMetadata,
  invalidateWorkspaceViewMetadata,
  markWorkspaceViewMetadataOutlineUntrusted,
  primeWorkspaceViewMetadata,
  primeWorkspaceViewMetadataFields,
  primeWorkspaceViewMetadataFromServer,
  resolveWorkspaceViewMetadata,
} from '../workspace-view-metadata';

jest.mock('@/application/session/event', () => ({
  EventType: {
    SESSION_INVALID: 'session_invalid',
  },
  on: jest.fn(),
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

const getTokenParsedMock = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
const onMock = on as jest.MockedFunction<typeof on>;
const sessionInvalidListener = onMock.mock.calls.find(([eventType]) => eventType === EventType.SESSION_INVALID)?.[1] as
  | (() => void)
  | undefined;

function setCurrentUser(userId: string | undefined): void {
  getTokenParsedMock.mockReturnValue(
    userId
      ? {
          access_token: 'access-token',
          expires_at: Date.now() + 60_000,
          refresh_token: 'refresh-token',
          user: { email: `${userId}@example.com`, id: userId },
        }
      : null
  );
}

function createView(viewId: string, name: string, children: View[] = []): View {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children,
    is_published: false,
    is_private: false,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe('workspace view metadata cache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-20T00:00:00Z'));
    clearWorkspaceViewMetadataCache();
    getTokenParsedMock.mockReset();
    setCurrentUser('user-a');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('recursively indexes every materialized outline node as flat metadata', () => {
    const grandchild = createView('grandchild', 'Grandchild');
    const child = createView('child', 'Child', [grandchild]);
    const parent = createView('parent', 'Parent', [child]);

    primeWorkspaceViewMetadata('workspace-a', parent);

    expect(getCachedWorkspaceViewMetadata('workspace-a', 'parent')).toEqual({ ...parent, children: [] });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'child')).toEqual({ ...child, children: [] });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'grandchild')).toEqual(grandchild);
    expect(parent.children).toEqual([child]);
  });

  it('finds and caches only the requested node from a loader subtree', async () => {
    const grandchild = createView('grandchild', 'Grandchild');
    const child = createView('child', 'Child', [grandchild]);
    const parent = createView('parent', 'Parent', [child]);

    await expect(resolveWorkspaceViewMetadata('workspace-a', 'child', async () => parent)).resolves.toEqual({
      ...child,
      children: [],
    });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'parent')).toBeUndefined();
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'child')).toEqual({ ...child, children: [] });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'grandchild')).toBeUndefined();
  });

  it('does not let an older raw server response overwrite a later resolver result', async () => {
    const staleRawToken = captureWorkspaceViewMetadataAccessToken('workspace-a');
    const resolvedView = createView('view-a', 'Resolver result');

    await expect(
      resolveWorkspaceViewMetadata('workspace-a', 'view-a', async () => resolvedView)
    ).resolves.toMatchObject({ name: 'Resolver result' });

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Older raw response'),
        staleRawToken
      )
    ).toBe(false);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Resolver result');
  });

  it('updates only the supplied flat keys for a fields event', () => {
    const child = createView('child', 'Child');
    const parent = createView('parent', 'Parent', [child]);

    primeWorkspaceViewMetadata('workspace-a', parent);
    const preEventToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    primeWorkspaceViewMetadataFields('workspace-a', createView('parent', 'Renamed parent'));

    expect(getCachedWorkspaceViewMetadata('workspace-a', 'parent')).toEqual({
      ...parent,
      name: 'Renamed parent',
      children: [],
    });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'child')).toEqual(child);
    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('parent', 'Response started before fields event'),
        preEventToken
      )
    ).toBe(false);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'parent')?.name).toBe('Renamed parent');
  });

  it('fences stale server outlines while accepting current server and granular updates after an access change', () => {
    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'Stale outline value'));
    const staleAccessToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    markWorkspaceViewMetadataOutlineUntrusted('workspace-a');

    // A permission refresh can preserve lazy children from the old tree. That
    // merged outline must not restore their metadata after broad invalidation.
    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'Preserved stale child'));
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Pre-change server response'),
        staleAccessToken
      )
    ).toBe(false);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();

    primeWorkspaceViewMetadataFields('workspace-a', createView('view-a', 'Queued field frame'));
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();

    const currentAccessToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Current server response'),
        currentAccessToken
      )
    ).toBe(true);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Current server response');

    // A folder frame queued before the access change could arrive late. While
    // merged-outline trust is suspended it invalidates the exact key instead
    // of resurrecting or updating it; the next read must go back to server.
    const preFieldEventToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    primeWorkspaceViewMetadataFields('workspace-a', createView('view-a', 'Live field update'));
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();
    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Response started before field event'),
        preFieldEventToken
      )
    ).toBe(false);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();

    const postFieldEventToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Server value after field invalidation'),
        postFieldEventToken
      )
    ).toBe(true);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe(
      'Server value after field invalidation'
    );
  });

  it('shares one in-flight loader and keeps positive metadata for the session', async () => {
    const deferred = createDeferred<View>();
    const firstLoader = jest.fn(() => deferred.promise);
    const unusedLoader = jest.fn(async () => createView('view-a', 'unused'));
    const first = resolveWorkspaceViewMetadata('workspace-a', 'view-a', firstLoader);
    const second = resolveWorkspaceViewMetadata('workspace-a', 'view-a', unusedLoader);

    await Promise.resolve();
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(unusedLoader).not.toHaveBeenCalled();

    const view = createView('view-a', 'View A');

    deferred.resolve(view);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ...view, children: [] },
      { ...view, children: [] },
    ]);

    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    await expect(resolveWorkspaceViewMetadata('workspace-a', 'view-a', unusedLoader)).resolves.toEqual({
      ...view,
      children: [],
    });
    expect(unusedLoader).not.toHaveBeenCalled();
  });

  it('refreshes a completed value while sharing the authoritative in-flight request', async () => {
    const deferred = createDeferred<View>();
    const refreshLoader = jest.fn(() => deferred.promise);
    const unusedLoader = jest.fn(async () => createView('view-a', 'unused'));

    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'Stale outline value'));

    const first = resolveWorkspaceViewMetadata('workspace-a', 'view-a', refreshLoader, { refresh: true });
    const second = resolveWorkspaceViewMetadata('workspace-a', 'view-a', unusedLoader, { refresh: true });

    await Promise.resolve();
    expect(refreshLoader).toHaveBeenCalledTimes(1);
    expect(unusedLoader).not.toHaveBeenCalled();

    deferred.resolve(createView('view-a', 'Fresh server value'));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ name: 'Fresh server value', children: [] }),
      expect.objectContaining({ name: 'Fresh server value', children: [] }),
    ]);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Fresh server value');
  });

  it('negative-caches loader errors for 30 seconds and then retries', async () => {
    const error = { code: -2, message: 'Record not found' };
    const failedLoader = jest.fn(async () => Promise.reject(error));
    const retryLoader = jest.fn(async () => createView('view-a', 'Recovered'));

    await expect(resolveWorkspaceViewMetadata('workspace-a', 'view-a', failedLoader)).rejects.toBe(error);
    await expect(resolveWorkspaceViewMetadata('workspace-a', 'view-a', retryLoader)).rejects.toBe(error);
    expect(failedLoader).toHaveBeenCalledTimes(1);
    expect(retryLoader).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_001);
    await expect(resolveWorkspaceViewMetadata('workspace-a', 'view-a', retryLoader)).resolves.toMatchObject({
      name: 'Recovered',
    });
    expect(retryLoader).toHaveBeenCalledTimes(1);
  });

  it('negative-caches an empty result without converting it into a rejection', async () => {
    const emptyLoader = jest.fn(async () => null);
    const unusedLoader = jest.fn(async () => createView('view-a', 'unused'));

    await expect(resolveWorkspaceViewMetadata('workspace-a', 'view-a', emptyLoader)).resolves.toBeUndefined();
    await expect(resolveWorkspaceViewMetadata('workspace-a', 'view-a', unusedLoader)).resolves.toBeUndefined();
    expect(emptyLoader).toHaveBeenCalledTimes(1);
    expect(unusedLoader).not.toHaveBeenCalled();
  });

  it('fences a superseded request from publishing or returning stale metadata', async () => {
    const staleRequest = createDeferred<View>();
    const currentRequest = createDeferred<View>();
    const stale = resolveWorkspaceViewMetadata('workspace-a', 'view-a', () => staleRequest.promise);

    await Promise.resolve();
    invalidateWorkspaceViewMetadata('workspace-a', 'view-a');

    const currentLoader = jest.fn(() => currentRequest.promise);
    const current = resolveWorkspaceViewMetadata('workspace-a', 'view-a', currentLoader);

    await Promise.resolve();
    staleRequest.resolve(createView('view-a', 'Stale'));
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    // The stale request's finally handler must not remove the newer request.
    const unusedLoader = jest.fn(async () => createView('view-a', 'unused'));
    const sharedCurrent = resolveWorkspaceViewMetadata('workspace-a', 'view-a', unusedLoader);

    expect(currentLoader).toHaveBeenCalledTimes(1);
    expect(unusedLoader).not.toHaveBeenCalled();

    currentRequest.resolve(createView('view-a', 'Current'));
    await expect(Promise.all([current, sharedCurrent])).resolves.toEqual([
      expect.objectContaining({ name: 'Current' }),
      expect.objectContaining({ name: 'Current' }),
    ]);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Current');
  });

  it('keeps targeted resolver precedence over bulk primes before and after it settles', async () => {
    const resolverRequest = createDeferred<View>();
    const tokenBeforeResolver = captureWorkspaceViewMetadataAccessToken('workspace-a');
    const pending = resolveWorkspaceViewMetadata('workspace-a', 'view-a', () => resolverRequest.promise);

    await Promise.resolve();
    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Raw response started before resolver'),
        tokenBeforeResolver
      )
    ).toBe(false);

    const tokenDuringResolver = captureWorkspaceViewMetadataAccessToken('workspace-a');

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Raw response during resolver'),
        tokenDuringResolver
      )
    ).toBe(true);
    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'Merged outline during resolver'));
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();

    resolverRequest.resolve(createView('view-a', 'Targeted resolver'));

    await expect(pending).resolves.toMatchObject({ name: 'Targeted resolver', children: [] });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Targeted resolver');

    const tokenAfterResolver = captureWorkspaceViewMetadataAccessToken('workspace-a');

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Late raw response'),
        tokenAfterResolver
      )
    ).toBe(true);
    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'Late merged outline'));
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Targeted resolver');
  });

  it('fences old workspace requests while allowing a fresh request after workspace invalidation', async () => {
    const staleRequest = createDeferred<View>();
    const currentRequest = createDeferred<View>();
    const stale = resolveWorkspaceViewMetadata('workspace-a', 'view-a', () => staleRequest.promise);

    await Promise.resolve();
    invalidateWorkspaceViewMetadata('workspace-a');

    const current = resolveWorkspaceViewMetadata('workspace-a', 'view-a', () => currentRequest.promise);

    await Promise.resolve();
    staleRequest.resolve(createView('view-a', 'Stale'));
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    currentRequest.resolve(createView('view-a', 'Current'));
    await expect(current).resolves.toMatchObject({ name: 'Current', children: [] });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('Current');
  });

  it('isolates metadata by user and workspace', () => {
    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'User A'));

    setCurrentUser('user-b');
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();

    setCurrentUser('user-a');
    expect(getCachedWorkspaceViewMetadata('workspace-b', 'view-a')).toBeUndefined();
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('User A');
  });

  it('aborts an old-user request instead of returning metadata from another user scope', async () => {
    const staleRequest = createDeferred<View>();
    const stale = resolveWorkspaceViewMetadata('workspace-a', 'view-a', () => staleRequest.promise);

    await Promise.resolve();
    setCurrentUser('user-b');
    primeWorkspaceViewMetadata('workspace-a', createView('view-a', 'User B'));
    staleRequest.resolve(createView('view-a', 'User A stale'));

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')?.name).toBe('User B');
  });

  it('supports exact and workspace-wide invalidation', () => {
    primeWorkspaceViewMetadata('workspace-a', [
      createView('view-a', 'View A'),
      createView('view-b', 'View B'),
    ]);
    primeWorkspaceViewMetadata('workspace-b', createView('view-c', 'View C'));

    invalidateWorkspaceViewMetadata('workspace-a', 'view-a');
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-b')).toBeDefined();

    invalidateWorkspaceViewMetadata('workspace-a');
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-b')).toBeUndefined();
    expect(getCachedWorkspaceViewMetadata('workspace-b', 'view-c')).toBeDefined();
  });

  it('fences a server response captured before exact invalidation', () => {
    const staleServerToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    invalidateWorkspaceViewMetadata('workspace-a', 'view-a');

    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('view-a', 'Response captured before removal'),
        staleServerToken
      )
    ).toBe(false);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'view-a')).toBeUndefined();
  });

  it('clears on session invalidation and aborts an old-session completion', async () => {
    expect(sessionInvalidListener).toBeDefined();
    primeWorkspaceViewMetadata('workspace-a', createView('cached', 'Cached'));
    const oldSessionServerToken = captureWorkspaceViewMetadataAccessToken('workspace-a');

    const staleRequest = createDeferred<View>();
    const stale = resolveWorkspaceViewMetadata('workspace-a', 'pending', () => staleRequest.promise);

    await Promise.resolve();
    sessionInvalidListener?.();
    setCurrentUser('user-b');
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'cached')).toBeUndefined();
    expect(
      primeWorkspaceViewMetadataFromServer(
        'workspace-a',
        createView('late-server-view', 'Old user response'),
        oldSessionServerToken
      )
    ).toBe(false);
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'late-server-view')).toBeUndefined();

    staleRequest.resolve(createView('pending', 'Old session'));
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCachedWorkspaceViewMetadata('workspace-a', 'pending')).toBeUndefined();
  });
});
