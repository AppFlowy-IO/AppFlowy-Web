import { db } from '@/application/db';
import { getView, signInWithPassword } from '@/application/services/js-services/http';
import { emit, EventType } from '@/application/session';
import { getTokenParsed, isTokenValid } from '@/application/session/token';
import { View, ViewLayout } from '@/application/types';

import {
  getAppViewCached,
  getCachedAppView,
  getCachedAppViewFromDisk,
  invalidateViewCache,
  invalidateWorkspaceViewMemoryCache,
  signInWithPasswordWithRedirect,
} from '../cached-api';

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
  isTokenValid: jest.fn(),
}));

jest.mock('@/application/ydoc/apply', () => ({
  applyYDoc: jest.fn(),
}));

jest.mock('@/utils/upload-tracker', () => ({
  registerUpload: jest.fn(() => 'upload-id'),
  unregisterUpload: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const appViewCacheTable = db.app_view_cache as unknown as {
  delete: jest.Mock;
  get: jest.Mock;
  put: jest.Mock;
};
const getTokenParsedMock = getTokenParsed as jest.Mock;
const getViewMock = getView as jest.Mock;
const isTokenValidMock = isTokenValid as jest.Mock;
const signInWithPasswordMock = signInWithPassword as jest.Mock;
const emitMock = emit as jest.Mock;

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

function createView(viewId: string, name: string): View {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('cached app view cache user scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appViewCacheTable.delete.mockResolvedValue(undefined);
    appViewCacheTable.get.mockResolvedValue(undefined);
    appViewCacheTable.put.mockResolvedValue(undefined);
  });

  it('reads durable view cache using the authenticated user key', async () => {
    const view = createView('view-from-disk', 'disk cache');

    setCurrentUser('user-a');
    appViewCacheTable.get.mockResolvedValue({
      user_id: 'user-a',
      workspace_id: 'workspace-a',
      view_id: view.view_id,
      data: view,
      updated_at: Date.now(),
    });

    await expect(getCachedAppViewFromDisk('workspace-a', view.view_id)).resolves.toBe(view);

    expect(appViewCacheTable.get).toHaveBeenCalledWith(['user-a', 'workspace-a', view.view_id]);
  });

  it('drops and deletes over-age durable view cache records', async () => {
    const view = createView('view-too-old', 'stale disk cache');
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;

    setCurrentUser('user-a');
    appViewCacheTable.get.mockResolvedValue({
      user_id: 'user-a',
      workspace_id: 'workspace-a',
      view_id: view.view_id,
      data: view,
      updated_at: Date.now() - eightDaysMs,
    });

    await expect(getCachedAppViewFromDisk('workspace-a', view.view_id)).resolves.toBeUndefined();

    expect(appViewCacheTable.delete).toHaveBeenCalledWith(['user-a', 'workspace-a', view.view_id]);
  });

  it('does not promote durable fallback data into the fresh in-memory cache', async () => {
    const workspaceId = 'workspace-disk-only';
    const viewId = 'view-disk-only';
    const diskView = createView(viewId, 'disk fallback');
    const serverView = createView(viewId, 'server view');

    setCurrentUser('user-a');
    appViewCacheTable.get.mockResolvedValue({
      user_id: 'user-a',
      workspace_id: workspaceId,
      view_id: viewId,
      data: diskView,
      updated_at: Date.now(),
    });
    getViewMock.mockResolvedValue(serverView);

    await expect(getCachedAppViewFromDisk(workspaceId, viewId)).resolves.toBe(diskView);
    expect(getCachedAppView(workspaceId, viewId)).toBeUndefined();

    await expect(getAppViewCached(workspaceId, viewId)).resolves.toBe(serverView);
    expect(getViewMock).toHaveBeenCalledWith(workspaceId, viewId);
  });

  it('keeps memory and durable view caches isolated across account switches', async () => {
    const workspaceId = 'workspace-switch';
    const viewId = 'view-switch';
    const userAView = createView(viewId, 'user A view');
    const userBView = createView(viewId, 'user B view');

    getViewMock.mockResolvedValueOnce(userAView).mockResolvedValueOnce(userBView);

    setCurrentUser('user-a');
    await expect(getAppViewCached(workspaceId, viewId)).resolves.toBe(userAView);
    expect(getCachedAppView(workspaceId, viewId)).toBe(userAView);

    setCurrentUser('user-b');
    expect(getCachedAppView(workspaceId, viewId)).toBeUndefined();
    await expect(getAppViewCached(workspaceId, viewId)).resolves.toBe(userBView);
    expect(getCachedAppView(workspaceId, viewId)).toBe(userBView);

    expect(getViewMock).toHaveBeenCalledTimes(2);
    expect(appViewCacheTable.put).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        user_id: 'user-a',
        workspace_id: workspaceId,
        view_id: viewId,
        data: userAView,
      })
    );
    expect(appViewCacheTable.put).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        user_id: 'user-b',
        workspace_id: workspaceId,
        view_id: viewId,
        data: userBView,
      })
    );
  });

  it('invalidates only the current user durable view cache entry', () => {
    setCurrentUser('user-a');

    invalidateViewCache('workspace-a', 'view-a');

    expect(appViewCacheTable.delete).toHaveBeenCalledWith(['user-a', 'workspace-a', 'view-a']);
  });

  it('fences an invalidated request from overwriting or detaching its replacement', async () => {
    const staleRequest = createDeferred<View>();
    const currentRequest = createDeferred<View>();
    const staleView = createView('view-a', 'stale');
    const currentView = createView('view-a', 'current');

    setCurrentUser('user-a');
    getViewMock.mockReturnValueOnce(staleRequest.promise).mockReturnValueOnce(currentRequest.promise);

    const stale = getAppViewCached('workspace-a', 'view-a');

    invalidateViewCache('workspace-a', 'view-a');
    const current = getAppViewCached('workspace-a', 'view-a');

    staleRequest.resolve(staleView);
    await expect(stale).resolves.toBe(staleView);

    // The old finally handler must not remove the replacement request.
    const sharedCurrent = getAppViewCached('workspace-a', 'view-a');

    expect(getViewMock).toHaveBeenCalledTimes(2);

    currentRequest.resolve(currentView);
    await expect(Promise.all([current, sharedCurrent])).resolves.toEqual([currentView, currentView]);
    expect(getCachedAppView('workspace-a', 'view-a')).toBe(currentView);
  });

  it('clears one workspace memory scope and fences its pending responses', async () => {
    const staleRequest = createDeferred<View>();
    const staleView = createView('pending-a', 'stale pending');
    const otherView = createView('view-b', 'other workspace');

    setCurrentUser('user-a');
    getViewMock.mockReturnValueOnce(staleRequest.promise).mockResolvedValueOnce(otherView);

    const stale = getAppViewCached('workspace-a', 'pending-a');

    await expect(getAppViewCached('workspace-b', 'view-b')).resolves.toBe(otherView);
    invalidateWorkspaceViewMemoryCache('workspace-a');

    expect(getCachedAppView('workspace-a', 'pending-a')).toBeUndefined();
    expect(getCachedAppView('workspace-b', 'view-b')).toBe(otherView);

    staleRequest.resolve(staleView);
    await expect(stale).resolves.toBe(staleView);
    expect(getCachedAppView('workspace-a', 'pending-a')).toBeUndefined();
    expect(appViewCacheTable.delete).not.toHaveBeenCalledWith(['user-a', 'workspace-a', 'pending-a']);
  });
});

describe('cached authentication state consistency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves the current session when an account-switch login fails', async () => {
    const loginError = new Error('Incorrect password');

    isTokenValidMock.mockReturnValue(true);
    signInWithPasswordMock.mockRejectedValueOnce(loginError);

    await expect(
      signInWithPasswordWithRedirect({
        email: 'other-account@example.com',
        password: 'wrong-password',
        redirectTo: '/app',
      })
    ).rejects.toBe(loginError);

    expect(emitMock).not.toHaveBeenCalledWith(EventType.SESSION_INVALID);
  });

  it('reports an invalid session when an initial login fails without stored credentials', async () => {
    const loginError = new Error('Incorrect password');

    isTokenValidMock.mockReturnValue(false);
    signInWithPasswordMock.mockRejectedValueOnce(loginError);

    await expect(
      signInWithPasswordWithRedirect({
        email: 'new-user@example.com',
        password: 'wrong-password',
        redirectTo: '/app',
      })
    ).rejects.toBe(loginError);

    expect(emitMock).toHaveBeenCalledWith(EventType.SESSION_INVALID);
  });
});
