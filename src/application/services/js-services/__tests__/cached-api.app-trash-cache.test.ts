import { getAppTrash } from '@/application/services/js-services/http';
import { getTokenParsed } from '@/application/session/token';
import { View, ViewLayout } from '@/application/types';

import { getAppTrashCached, refreshAppTrashCache } from '../cached-api';

jest.mock('@/application/db', () => ({
  db: {
    app_view_cache: {
      delete: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
    },
  },
  openCollabDB: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  createRow: jest.fn(),
  deleteRow: jest.fn(),
  deleteView: jest.fn(),
  getPageDoc: jest.fn(),
  getPublishView: jest.fn(),
  getPublishViewMeta: jest.fn(),
  getUser: jest.fn(),
  hasCollabCache: jest.fn(),
  hasViewMetaCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/device-id', () => ({
  getOrCreateDeviceId: jest.fn(() => 'device-id'),
}));

jest.mock('@/application/services/js-services/fetch', () => ({
  fetchPageCollab: jest.fn(),
  fetchPublishView: jest.fn(),
  fetchPublishViewMeta: jest.fn(),
  fetchViewInfo: jest.fn(),
}));

jest.mock('@/application/services/js-services/http', () => ({
  cancelImportTask: jest.fn(),
  changePassword: jest.fn(),
  createImportTask: jest.fn(),
  duplicatePublishView: jest.fn(),
  forgotPassword: jest.fn(),
  getAppTrash: jest.fn(),
  getCollab: jest.fn(),
  getCurrentUser: jest.fn(),
  getUserWorkspaceInfo: jest.fn(),
  getView: jest.fn(),
  publishView: jest.fn(),
  signInApple: jest.fn(),
  signInDiscord: jest.fn(),
  signInGithub: jest.fn(),
  signInGoogle: jest.fn(),
  signInOTP: jest.fn(),
  signInSaml: jest.fn(),
  signInWithMagicLink: jest.fn(),
  signInWithPassword: jest.fn(),
  signInWithUrl: jest.fn(),
  signUpWithPassword: jest.fn(),
  unpublishView: jest.fn(),
  updatePublishConfig: jest.fn(),
  updatePublishNamespace: jest.fn(),
  uploadFileMultipart: jest.fn(),
  uploadImportFile: jest.fn(),
  uploadImportFileMultipart: jest.fn(),
}));

jest.mock('@/application/session', () => ({
  emit: jest.fn(),
  EventType: {
    SESSION_INVALID: 'SESSION_INVALID',
    SESSION_VALID: 'SESSION_VALID',
  },
}));

jest.mock('@/application/session/sign_in', () => ({
  afterAuth: jest.fn(),
  AUTH_CALLBACK_URL: 'http://localhost/auth/callback',
  getAuthCallbackUrl: jest.fn(() => 'http://localhost/auth/callback'),
  saveRedirectTo: jest.fn(),
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

jest.mock('@/application/ydoc/apply', () => ({
  applyYDoc: jest.fn(),
}));

jest.mock('@/utils/upload-tracker', () => ({
  registerUpload: jest.fn(() => 'upload-id'),
  unregisterUpload: jest.fn(),
}));

const getTokenParsedMock = getTokenParsed as jest.Mock;
const getAppTrashMock = getAppTrash as jest.Mock;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function setCurrentUser(userId: string | undefined) {
  getTokenParsedMock.mockReturnValue(
    userId
      ? {
          access_token: 'access-token',
          expires_at: Date.now() + 60000,
          refresh_token: 'refresh-token',
          user: {
            email: `${userId}@example.com`,
            id: userId,
          },
        }
      : null
  );
}

function createTrashView(viewId: string): View {
  return {
    view_id: viewId,
    name: `trash ${viewId}`,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

describe('cached app trash', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setCurrentUser('user-a');
  });

  it('serves the TTL cache instead of refetching within the window', async () => {
    const workspaceId = 'workspace-trash-ttl';
    const trash = [createTrashView('trashed-1')];

    getAppTrashMock.mockResolvedValue(trash);

    await expect(getAppTrashCached(workspaceId)).resolves.toBe(trash);
    await expect(getAppTrashCached(workspaceId)).resolves.toBe(trash);

    expect(getAppTrashMock).toHaveBeenCalledTimes(1);
  });

  it('dedups concurrent callers into a single request', async () => {
    const workspaceId = 'workspace-trash-concurrent';
    const trash = [createTrashView('trashed-2')];

    getAppTrashMock.mockResolvedValue(trash);

    const [first, second] = await Promise.all([
      getAppTrashCached(workspaceId),
      getAppTrashCached(workspaceId),
    ]);

    expect(first).toBe(trash);
    expect(second).toBe(trash);
    expect(getAppTrashMock).toHaveBeenCalledTimes(1);
  });

  it('refresh bypasses the TTL cache but still shares in-flight requests', async () => {
    const workspaceId = 'workspace-trash-refresh';
    const initial = [createTrashView('trashed-3')];
    const refreshed = [createTrashView('trashed-3'), createTrashView('trashed-4')];

    getAppTrashMock.mockResolvedValueOnce(initial).mockResolvedValue(refreshed);

    await expect(getAppTrashCached(workspaceId)).resolves.toBe(initial);

    const [refreshA, refreshB] = await Promise.all([
      refreshAppTrashCache(workspaceId),
      refreshAppTrashCache(workspaceId),
    ]);

    expect(refreshA).toBe(refreshed);
    expect(refreshB).toBe(refreshed);
    expect(getAppTrashMock).toHaveBeenCalledTimes(2);

    // The refreshed payload replaces the TTL cache entry
    await expect(getAppTrashCached(workspaceId)).resolves.toBe(refreshed);
    expect(getAppTrashMock).toHaveBeenCalledTimes(2);
  });

  it('queues one fresh request when an app mutation arrives during a DatabaseBlock cache read', async () => {
    const workspaceId = 'workspace-trash-cache-then-mutation';
    const beforeMutation = [createTrashView('before-mutation')];
    const afterMutation = [createTrashView('after-mutation')];
    const initialRequest = createDeferred<View[]>();

    getAppTrashMock.mockReturnValueOnce(initialRequest.promise).mockResolvedValueOnce(afterMutation);

    const databaseBlockRead = getAppTrashCached(workspaceId);
    const appRefresh = refreshAppTrashCache(workspaceId, 'folder:2-1');
    const duplicateObserver = refreshAppTrashCache(workspaceId, 'folder:2-1');

    expect(getAppTrashMock).toHaveBeenCalledTimes(1);

    initialRequest.resolve(beforeMutation);

    await expect(databaseBlockRead).resolves.toBe(beforeMutation);
    await expect(Promise.all([appRefresh, duplicateObserver])).resolves.toEqual([
      afterMutation,
      afterMutation,
    ]);
    expect(getAppTrashMock).toHaveBeenCalledTimes(2);

    await expect(getAppTrashCached(workspaceId)).resolves.toBe(afterMutation);
    expect(getAppTrashMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces multiple newer mutation keys into one trailing refresh', async () => {
    const workspaceId = 'workspace-trash-one-trailing-refresh';
    const initialRequest = createDeferred<View[]>();
    const latest = [createTrashView('latest-trash')];

    getAppTrashMock.mockReturnValueOnce(initialRequest.promise).mockResolvedValueOnce(latest);

    const initialRead = getAppTrashCached(workspaceId);
    const firstMutation = refreshAppTrashCache(workspaceId, 'folder:3-1');
    const secondMutation = refreshAppTrashCache(workspaceId, 'folder:4-1');

    initialRequest.resolve([]);

    await expect(initialRead).resolves.toEqual([]);
    await expect(Promise.all([firstMutation, secondMutation])).resolves.toEqual([latest, latest]);
    expect(getAppTrashMock).toHaveBeenCalledTimes(2);
  });

  it('runs a queued mutation refresh after the leading request fails', async () => {
    const workspaceId = 'workspace-trash-leading-failure';
    const initialRequest = createDeferred<View[]>();
    const recovered = [createTrashView('recovered-trash')];

    getAppTrashMock.mockReturnValueOnce(initialRequest.promise).mockResolvedValueOnce(recovered);

    const initialRead = getAppTrashCached(workspaceId);
    const mutationRefresh = refreshAppTrashCache(workspaceId, 'folder:6-1');

    initialRequest.reject(new Error('initial request failed'));

    await expect(initialRead).rejects.toThrow('initial request failed');
    await expect(mutationRefresh).resolves.toBe(recovered);
    expect(getAppTrashMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const workspaceId = 'workspace-trash-error';
    const trash = [createTrashView('trashed-5')];

    getAppTrashMock.mockRejectedValueOnce({ code: -1, message: 'Network error' }).mockResolvedValue(trash);

    await expect(getAppTrashCached(workspaceId)).rejects.toEqual({ code: -1, message: 'Network error' });
    await expect(getAppTrashCached(workspaceId)).resolves.toBe(trash);

    expect(getAppTrashMock).toHaveBeenCalledTimes(2);
  });

  it('keeps trash caches isolated across account switches', async () => {
    const workspaceId = 'workspace-trash-users';
    const userATrash = [createTrashView('user-a-trash')];
    const userBTrash = [createTrashView('user-b-trash')];

    getAppTrashMock.mockResolvedValueOnce(userATrash).mockResolvedValueOnce(userBTrash);

    setCurrentUser('user-a');
    await expect(getAppTrashCached(workspaceId)).resolves.toBe(userATrash);

    setCurrentUser('user-b');
    await expect(getAppTrashCached(workspaceId)).resolves.toBe(userBTrash);

    expect(getAppTrashMock).toHaveBeenCalledTimes(2);
  });
});
