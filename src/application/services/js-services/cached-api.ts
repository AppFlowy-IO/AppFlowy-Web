/**
 * Cached/stateful API functions extracted from AFClientService.
 * These functions have real logic beyond simple passthrough (caching, state, transforms).
 * Module-level state replaces the singleton class instance state.
 */
import * as random from 'lib0/random';
import * as Y from 'yjs';

import { db, openCollabDB } from '@/application/db';
import {
  createRow,
  deleteRow,
  deleteView,
  getPageDoc,
  getPublishView,
  getPublishViewMeta,
  getUser,
  hasCollabCache,
  hasViewMetaCache,
} from '@/application/services/js-services/cache';
import { StrategyType } from '@/application/services/js-services/cache/types';
import { getOrCreateDeviceId } from '@/application/services/js-services/device-id';
import {
  fetchPageCollab,
  fetchPublishView,
  fetchPublishViewMeta,
  fetchViewInfo,
} from '@/application/services/js-services/fetch';
import {
  getAppTrash,
  getView,
  signInWithUrl,
  uploadFileMultipart,
  cancelImportTask,
  CreateImportTaskType,
  createImportTask,
  uploadImportFile,
  uploadImportFileMultipart,
  publishView as publishViewAPI,
  unpublishView as unpublishViewAPI,
  updatePublishConfig as updatePublishConfigAPI,
  updatePublishNamespace as updatePublishNamespaceAPI,
  getCollab,
  getCurrentUser as getCurrentUserAPI,
  getUserWorkspaceInfo as getUserWorkspaceInfoAPI,
  duplicatePublishView as duplicatePublishViewAPI,
  changePassword,
  forgotPassword,
  signInApple,
  signInDiscord,
  signInGithub,
  signInGoogle,
  signInOTP,
  signInSaml,
  signInCustomProvider,
  signInWithLdap,
  signInWithMagicLink,
  signInWithPassword,
  signUpWithPassword,
} from '@/application/services/js-services/http';
import { emit, EventType } from '@/application/session';
import { afterAuth, AUTH_CALLBACK_URL, saveRedirectTo } from '@/application/session/sign_in';
import { getTokenParsed, isTokenValid } from '@/application/session/token';
import {
  DatabaseRelations,
  DuplicatePublishView,
  DuplicatePublishViewResponse,
  PublishViewPayload,
  Types,
  UpdatePublishConfigPayload,
  UploadPublishNamespacePayload,
  UserWorkspaceInfo,
  View,
  YjsEditorKey,
} from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';
import { registerUpload, unregisterUpload } from '@/utils/upload-tracker';

// ============================================================================
// Module-level state (replaces AFClientService instance state)
// ============================================================================

const clientId = random.uint32();
const deviceId = getOrCreateDeviceId();

const viewLoaded = new Set<string>();
const publishViewLoaded = new Set<string>();
const publishViewInfo = new Map<
  string,
  {
    namespace: string;
    publishName: string;
    publisherEmail: string;
    viewId: string;
    publishedAt: string;
    commentEnabled: boolean;
    duplicateEnabled: boolean;
  }
>();

type AppViewCacheScope = {
  userId: string | undefined;
  workspaceId: string;
  viewId: string;
};

type AppViewInFlight = AppViewCacheScope & {
  identity: object;
  promise: Promise<View>;
};

type AppViewCacheEntry = AppViewCacheScope & {
  data: View;
  expiresAt: number;
};

const _getAppViewInFlight = new Map<string, AppViewInFlight>();
const _getAppViewCache = new Map<string, AppViewCacheEntry>();
const VIEW_CACHE_TTL_MS = 5000;
// Disk records are a fast-paint/offline fallback that is normally replaced by a
// network refresh; the age cap only bounds how stale that fallback can get when
// the refresh fails.
const VIEW_DISK_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANONYMOUS_VIEW_CACHE_SCOPE = 'anonymous';

type AppTrashPendingRefresh = {
  promise: Promise<View[]>;
  resolve: (views: View[]) => void;
  reject: (error: unknown) => void;
};

type AppTrashRequestState = {
  active: Promise<View[]> | null;
  activeFreshnessKey: string | undefined;
  pendingRefresh: AppTrashPendingRefresh | null;
  pendingFreshnessKey: string | undefined;
};

const _getAppTrashRequests = new Map<string, AppTrashRequestState>();
const _getAppTrashCache = new Map<string, { data: View[]; expiresAt: number }>();
const TRASH_CACHE_TTL_MS = 5000;

// ============================================================================
// Simple getters
// ============================================================================

export function getClientId() {
  return clientId;
}

export function getDeviceId() {
  return deviceId;
}

// ============================================================================
// Cached/stateful methods
// ============================================================================

/**
 * In-flight dedup + short-lived result cache for getAppView.
 * Multiple components (AppPage, AppBusinessLayer, useViewMeta) independently call
 * getAppView for the same view during renders/re-renders.
 */
function getCurrentAppViewCacheUserId() {
  return getTokenParsed()?.user?.id;
}

function getAppViewCacheKey(userId: string | undefined, workspaceId: string, viewId: string) {
  return `${userId ?? ANONYMOUS_VIEW_CACHE_SCOPE}:${workspaceId}:${viewId}`;
}

function writeAppViewCaches(workspaceId: string, viewId: string, data: View, userId = getCurrentAppViewCacheUserId()) {
  _getAppViewCache.set(getAppViewCacheKey(userId, workspaceId, viewId), {
    userId,
    workspaceId,
    viewId,
    data,
    expiresAt: Date.now() + VIEW_CACHE_TTL_MS,
  });

  if (!userId) return;

  void db.app_view_cache
    .put({
      user_id: userId,
      workspace_id: workspaceId,
      view_id: viewId,
      data,
      updated_at: Date.now(),
    })
    .catch((error) => {
      Log.warn('[ViewCache] failed to persist app view cache', {
        userId,
        workspaceId,
        viewId,
        error,
      });
    });
}

function requestAppView(workspaceId: string, viewId: string, userId = getCurrentAppViewCacheUserId()) {
  const key = getAppViewCacheKey(userId, workspaceId, viewId);
  const existing = _getAppViewInFlight.get(key);

  if (existing) {
    return existing.promise;
  }

  const identity = {};
  const request = getView(workspaceId, viewId)
    .then((result) => {
      // A permission/catalog mutation may invalidate this request and start a
      // replacement before the old response settles. Only the request that is
      // still registered for this key may repopulate memory or durable cache.
      if (_getAppViewInFlight.get(key)?.identity === identity) {
        writeAppViewCaches(workspaceId, viewId, result, userId);
      }

      return result;
    })
    .finally(() => {
      if (_getAppViewInFlight.get(key)?.identity === identity) {
        _getAppViewInFlight.delete(key);
      }
    });

  _getAppViewInFlight.set(key, { userId, workspaceId, viewId, identity, promise: request });
  return request;
}

export async function getAppViewCached(workspaceId: string, viewId: string) {
  const userId = getCurrentAppViewCacheUserId();
  const key = getAppViewCacheKey(userId, workspaceId, viewId);

  // 1. Return cached result if still fresh
  const cached = _getAppViewCache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 2. Share in-flight request if one exists
  return requestAppView(workspaceId, viewId, userId);
}

export function getCachedAppView(workspaceId: string, viewId: string): View | undefined {
  const key = getAppViewCacheKey(getCurrentAppViewCacheUserId(), workspaceId, viewId);
  const cached = _getAppViewCache.get(key);

  if (!cached) return undefined;

  if (Date.now() >= cached.expiresAt) {
    _getAppViewCache.delete(key);
    return undefined;
  }

  return cached.data;
}

export async function getCachedAppViewFromDisk(workspaceId: string, viewId: string): Promise<View | undefined> {
  const userId = getCurrentAppViewCacheUserId();

  if (!userId) return undefined;

  const record = await db.app_view_cache.get([userId, workspaceId, viewId]);

  if (!record) return undefined;

  if (Date.now() - record.updated_at > VIEW_DISK_CACHE_MAX_AGE_MS) {
    void db.app_view_cache.delete([userId, workspaceId, viewId]).catch(() => undefined);
    return undefined;
  }

  return record.data;
}

export async function refreshAppViewCache(workspaceId: string, viewId: string) {
  return requestAppView(workspaceId, viewId);
}

export function invalidateViewCache(workspaceId: string, viewId: string) {
  const userId = getCurrentAppViewCacheUserId();
  const key = getAppViewCacheKey(userId, workspaceId, viewId);

  _getAppViewCache.delete(key);
  _getAppViewInFlight.delete(key);

  if (!userId) return;

  void db.app_view_cache.delete([userId, workspaceId, viewId]).catch((error) => {
    Log.warn('[ViewCache] failed to delete app view cache', {
      userId,
      workspaceId,
      viewId,
      error,
    });
  });
}

/**
 * Drop only the current user's in-memory view metadata for one workspace.
 *
 * Permission changes can affect descendants whose IDs are not present in the
 * lazy outline, so targeted invalidation is insufficient. Durable entries are
 * retained for permission-revocation cleanup and are never promoted by the
 * normal metadata resolver.
 */
export function invalidateWorkspaceViewMemoryCache(workspaceId: string) {
  const userId = getCurrentAppViewCacheUserId();

  for (const [key, entry] of _getAppViewCache) {
    if (entry.userId === userId && entry.workspaceId === workspaceId) {
      _getAppViewCache.delete(key);
    }
  }

  for (const [key, entry] of _getAppViewInFlight) {
    if (entry.userId === userId && entry.workspaceId === workspaceId) {
      _getAppViewInFlight.delete(key);
    }
  }
}

/**
 * In-flight dedup + short-lived result cache for getAppTrash.
 * Every embedded DatabaseBlock probes the trash list to detect deleted
 * containers, so a page with several embedded databases would otherwise fire
 * one trash request per block.
 */
function getAppTrashCacheKey(userId: string | undefined, workspaceId: string) {
  return `${userId ?? ANONYMOUS_VIEW_CACHE_SCOPE}:${workspaceId}`;
}

function getAppTrashRequestState(key: string) {
  let state = _getAppTrashRequests.get(key);

  if (!state) {
    state = {
      active: null,
      activeFreshnessKey: undefined,
      pendingRefresh: null,
      pendingFreshnessKey: undefined,
    };
    _getAppTrashRequests.set(key, state);
  }

  return state;
}

function startAppTrashRequest(
  workspaceId: string,
  userId: string | undefined,
  key: string,
  state: AppTrashRequestState,
  freshnessKey?: string
) {
  const request = getAppTrash(workspaceId).then((views) => {
    _getAppTrashCache.set(key, {
      data: views,
      expiresAt: Date.now() + TRASH_CACHE_TTL_MS,
    });
    return views;
  });

  state.active = request;
  state.activeFreshnessKey = freshnessKey;

  // A refresh requested while this call is active represents a notification
  // that may have been committed after the request started. Run exactly one
  // trailing request and let every waiter share it. This avoids returning a
  // pre-mutation response without allowing request storms.
  void request.then(
    () => finishAppTrashRequest(workspaceId, userId, key, state, request),
    () => finishAppTrashRequest(workspaceId, userId, key, state, request)
  );

  return request;
}

function finishAppTrashRequest(
  workspaceId: string,
  userId: string | undefined,
  key: string,
  state: AppTrashRequestState,
  request: Promise<View[]>
) {
  if (state.active !== request) return;

  state.active = null;
  state.activeFreshnessKey = undefined;
  const pendingRefresh = state.pendingRefresh;
  const pendingFreshnessKey = state.pendingFreshnessKey;

  if (!pendingRefresh) {
    if (_getAppTrashRequests.get(key) === state) {
      _getAppTrashRequests.delete(key);
    }

    return;
  }

  state.pendingRefresh = null;
  state.pendingFreshnessKey = undefined;
  const trailingRequest = startAppTrashRequest(workspaceId, userId, key, state, pendingFreshnessKey);

  void trailingRequest.then(pendingRefresh.resolve, pendingRefresh.reject);
}

function requestAppTrash(workspaceId: string, userId = getCurrentAppViewCacheUserId()) {
  const key = getAppTrashCacheKey(userId, workspaceId);
  const state = getAppTrashRequestState(key);

  if (state.active) {
    return state.active;
  }

  return startAppTrashRequest(workspaceId, userId, key, state);
}

export async function getAppTrashCached(workspaceId: string) {
  const userId = getCurrentAppViewCacheUserId();
  const key = getAppTrashCacheKey(userId, workspaceId);
  const activeState = _getAppTrashRequests.get(key);

  // Prefer an authoritative refresh already underway over a still-valid cache.
  // If that refresh itself has a newer mutation queued, wait for the trailing
  // payload so a mounting DatabaseBlock cannot briefly apply stale trash.
  if (activeState?.pendingRefresh) {
    return activeState.pendingRefresh.promise;
  }

  if (activeState?.active) {
    return activeState.active;
  }

  const cached = _getAppTrashCache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  return requestAppTrash(workspaceId, userId);
}

/**
 * Bypasses the TTL cache. Callers may pass a mutation/revision key. Repeated
 * observers of the same key share the active request; a newer keyed refresh
 * queues at most one trailing request rather than trusting a response that may
 * have started before that mutation. Unkeyed concurrent callers simply share.
 */
export async function refreshAppTrashCache(workspaceId: string, freshnessKey?: string) {
  const userId = getCurrentAppViewCacheUserId();
  const key = getAppTrashCacheKey(userId, workspaceId);
  const state = getAppTrashRequestState(key);

  if (!state.active) {
    return startAppTrashRequest(workspaceId, userId, key, state, freshnessKey);
  }

  if (state.pendingRefresh) {
    return state.pendingRefresh.promise;
  }

  // Unkeyed refreshes are ordinary concurrent callers and share the active
  // request. A keyed refresh denotes a concrete mutation/revision; repeated
  // observers of that same revision share as well.
  if (!freshnessKey || state.activeFreshnessKey === freshnessKey) {
    return state.active;
  }

  let resolve!: (views: View[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<View[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  state.pendingRefresh = { promise, resolve, reject };
  state.pendingFreshnessKey = freshnessKey;
  return promise;
}

export async function getPageDocCached(
  workspaceId: string,
  viewId: string,
  errorCallback?: (error: { code: number }) => void
) {
  const token = getTokenParsed();
  const userId = token?.user.id;

  if (!userId) {
    throw new Error('User not found');
  }

  const name = viewId;
  const isLoaded = viewLoaded.has(name);

  const doc = await getPageDoc(
    async () => {
      try {
        return await fetchPageCollab(workspaceId, viewId);
        // eslint-disable-next-line
      } catch (e: any) {
        console.error(e);

        errorCallback?.(e);
        void (async () => {
          viewLoaded.delete(name);
          void deleteView(name);
        })();

        return Promise.reject(e);
      }
    },
    name,
    StrategyType.CACHE_ONLY
  );

  if (!isLoaded) {
    viewLoaded.add(name);
  }

  return doc;
}

export async function getPublishViewCached(namespace: string, publishName: string) {
  const name = `${namespace}_${publishName}`;
  const isLoaded = publishViewLoaded.has(name);

  const { doc } = await getPublishView(
    async () => {
      try {
        return await fetchPublishView(namespace, publishName);
      } catch (e) {
        console.error(e);
        void (async () => {
          if (await hasViewMetaCache(name)) {
            publishViewLoaded.delete(name);
            void deleteView(name);
          }
        })();

        return Promise.reject(e);
      }
    },
    {
      namespace,
      publishName,
    },
    isLoaded ? StrategyType.CACHE_FIRST : StrategyType.CACHE_AND_NETWORK
  );

  if (!isLoaded) {
    publishViewLoaded.add(name);
  }

  return doc;
}

export async function getPublishViewMetaCached(namespace: string, publishName: string) {
  const name = `${namespace}_${publishName}`;
  const isLoaded = publishViewLoaded.has(name);

  const viewMeta = await getPublishViewMeta(
    () => {
      return fetchPublishViewMeta(namespace, publishName);
    },
    {
      namespace,
      publishName,
    },
    isLoaded ? StrategyType.CACHE_FIRST : StrategyType.CACHE_AND_NETWORK
  );

  if (!viewMeta) {
    return Promise.reject(new Error('View has not been published yet'));
  }

  return viewMeta;
}

export async function getPublishInfoCached(viewId: string) {
  if (publishViewInfo.has(viewId)) {
    return publishViewInfo.get(viewId) as {
      namespace: string;
      publishName: string;
      publisherEmail: string;
      viewId: string;
      publishedAt: string;
      commentEnabled: boolean;
      duplicateEnabled: boolean;
    };
  }

  const info = await fetchViewInfo(viewId);
  const namespace = info.namespace;

  if (!namespace) {
    return Promise.reject(new Error('View not found'));
  }

  const data = {
    namespace,
    publishName: info.publish_name,
    publisherEmail: info.publisher_email,
    viewId: info.view_id,
    publishedAt: info.publish_timestamp,
    commentEnabled: info.comments_enabled,
    duplicateEnabled: info.duplicate_enabled,
  };

  publishViewInfo.set(viewId, data);

  return data;
}

export async function loginAuth(url: string) {
  return finishAuthFlow('loginAuth', () => signInWithUrl(url));
}

async function finishAuthFlow(
  logContext: string,
  runAuthFlow: () => Promise<unknown>,
  options?: { emitSessionValid?: boolean }
) {
  Log.info(`[Auth] ${logContext}: completing login flow`);
  try {
    await runAuthFlow();
    Log.info(`[Auth] ${logContext}: success, calling afterAuth`);
    if (options?.emitSessionValid !== false) {
      emit(EventType.SESSION_VALID);
    }

    afterAuth();
  } catch (e) {
    Log.error(`[Auth] ${logContext}: failed`, e);
    // A failed account-switch attempt must not hide the still-valid current
    // session. Lower layers remove invalid credentials before rejecting.
    if (!isTokenValid()) {
      emit(EventType.SESSION_INVALID);
    }

    return Promise.reject(e);
  }
}

export async function getCurrentUserCached(workspaceId?: string) {
  const token = getTokenParsed();
  const userId = token?.user?.id;

  const user = await getUser(() => getCurrentUserAPI(workspaceId), userId, StrategyType.NETWORK_ONLY);

  if (!user) {
    return Promise.reject(new Error('User not found'));
  }

  return user;
}

export async function getUserWorkspaceInfoTransformed(): Promise<UserWorkspaceInfo> {
  const workspaceInfo = await getUserWorkspaceInfoAPI();

  if (!workspaceInfo) {
    return Promise.reject(new Error('Workspace info not found'));
  }

  return {
    userId: workspaceInfo.user_id,
    selectedWorkspace: workspaceInfo.selected_workspace,
    workspaces: workspaceInfo.workspaces,
  };
}

export async function duplicatePublishViewTransformed(
  params: DuplicatePublishView
): Promise<DuplicatePublishViewResponse> {
  const response = await duplicatePublishViewAPI(params.workspaceId, {
    dest_view_id: params.spaceViewId,
    published_view_id: params.viewId,
    published_collab_type: params.collabType,
  });

  // Transform snake_case API response to camelCase for frontend use
  return {
    viewId: response.view_id,
    databaseMappings: response.database_mappings || {},
  };
}

export async function getAppDatabaseViewRelationsFromCollab(workspaceId: string, databaseStorageId: string) {
  const res = await getCollab(workspaceId, databaseStorageId, Types.WorkspaceDatabase);
  const doc = new Y.Doc();

  applyYDoc(doc, res.data);

  const { databases } = doc.getMap(YjsEditorKey.data_section).toJSON();
  const result: DatabaseRelations = {};

  databases.forEach((database: { database_id: string; views: string[] }) => {
    result[database.database_id] = database.views[0];
  });
  return result;
}

export async function uploadFileWithTracking(
  workspaceId: string,
  viewId: string,
  file: File,
  onProgress?: (progress: number) => void
) {
  const uploadId = registerUpload();

  try {
    return await uploadFileMultipart({
      workspaceId,
      viewId,
      file,
      onProgress: (p) => onProgress?.(p.percentage / 100),
    });
  } finally {
    unregisterUpload(uploadId);
  }
}

export interface ImportFileWithUploadOptions {
  taskType: CreateImportTaskType;
  onProgress: (progress: number) => void;
}

export async function importFileWithUpload(file: File, { taskType, onProgress }: ImportFileWithUploadOptions) {
  const task = await createImportTask(file, taskType);

  try {
    if (task.multipart) {
      await uploadImportFileMultipart(file, task.multipart, onProgress);
    } else {
      await uploadImportFile(task.presignedUrl, file, onProgress);
    }
  } catch (err) {
    // Cancel the task so the worker doesn't try to process a partial upload
    void cancelImportTask(task.taskId).catch((cancelError) => {
      Log.warn('[Import] Failed to cancel import task after upload error', cancelError);
    });
    throw err;
  }
}

export async function publishViewClearingCache(workspaceId: string, viewId: string, payload?: PublishViewPayload) {
  if (publishViewInfo.has(viewId)) {
    publishViewInfo.delete(viewId);
  }

  return publishViewAPI(workspaceId, viewId, payload);
}

export function clearPublishViewInfoCache(viewId: string) {
  publishViewInfo.delete(viewId);
}

export async function unpublishViewClearingCache(workspaceId: string, viewId: string) {
  if (publishViewInfo.has(viewId)) {
    publishViewInfo.delete(viewId);
  }

  return unpublishViewAPI(workspaceId, viewId);
}

export async function updatePublishConfigClearingCache(workspaceId: string, config: UpdatePublishConfigPayload) {
  publishViewInfo.delete(config.view_id);
  return updatePublishConfigAPI(workspaceId, config);
}

export async function updatePublishNamespaceClearingCache(workspaceId: string, payload: UploadPublishNamespacePayload) {
  publishViewInfo.clear();
  return updatePublishNamespaceAPI(workspaceId, payload);
}

// ============================================================================
// Dexie cache passthrough methods
// ============================================================================

export async function getPublishRowDocument(viewId: string) {
  const doc = await openCollabDB(viewId);

  if (hasCollabCache(doc)) {
    return doc;
  }

  return Promise.reject(new Error('Document not found'));
}

export { createRow, deleteRow };

// ============================================================================
// Auth wrapper functions (replace @withSignIn decorator)
// ============================================================================

// These low-level GoTrue functions complete provider-specific work only. UI login
// paths should use the redirect-aware wrappers below so session events and
// afterAuth() stay consistent across OAuth, password, signup, and OTP.
export {
  signInWithPassword,
  signUpWithPassword,
  forgotPassword,
  changePassword,
  signInOTP,
  signInWithMagicLink,
  signInGoogle,
  signInApple,
  signInGithub,
  signInDiscord,
  signInSaml,
};

export async function signInGoogleWithRedirect(params: { redirectTo: string }) {
  saveRedirectTo(params.redirectTo);
  return signInGoogle(AUTH_CALLBACK_URL);
}

export async function signInAppleWithRedirect(params: { redirectTo: string }) {
  saveRedirectTo(params.redirectTo);
  return signInApple(AUTH_CALLBACK_URL);
}

export async function signInGithubWithRedirect(params: { redirectTo: string }) {
  saveRedirectTo(params.redirectTo);
  return signInGithub(AUTH_CALLBACK_URL);
}

export async function signInDiscordWithRedirect(params: { redirectTo: string }) {
  saveRedirectTo(params.redirectTo);
  return signInDiscord(AUTH_CALLBACK_URL);
}

export async function signInSamlWithRedirect(params: { redirectTo: string; domain: string }): Promise<void> {
  saveRedirectTo(params.redirectTo);
  return signInSaml(AUTH_CALLBACK_URL, params.domain);
}

export async function signInCustomProviderWithRedirect(params: {
  redirectTo: string;
  identifier: string;
}): Promise<void> {
  saveRedirectTo(params.redirectTo);
  return signInCustomProvider(params.identifier, AUTH_CALLBACK_URL);
}

/**
 * LDAP completes server-side, so unlike the redirect providers above there is
 * no callback to come back through — the tokens are already in hand and the
 * flow finishes here, exactly as a password sign-in does.
 */
export async function signInWithLdapWithRedirect(params: {
  username: string;
  password: string;
  connectionId?: string;
  redirectTo: string;
}) {
  saveRedirectTo(params.redirectTo);
  return finishAuthFlow('signInWithLdap', () => signInWithLdap(params.username, params.password, params.connectionId));
}

export async function signInWithPasswordWithRedirect(params: { email: string; password: string; redirectTo: string }) {
  saveRedirectTo(params.redirectTo);
  return finishAuthFlow('signInWithPassword', () => signInWithPassword(params));
}

export async function signUpWithPasswordWithRedirect(params: { email: string; password: string; redirectTo: string }) {
  saveRedirectTo(params.redirectTo);
  return finishAuthFlow('signUpWithPassword', () => signUpWithPassword(params));
}

export async function signInMagicLinkWithRedirect({ email, redirectTo }: { email: string; redirectTo: string }) {
  saveRedirectTo(redirectTo);
  return signInWithMagicLink(email, AUTH_CALLBACK_URL);
}

export async function signInOTPWithRedirect(params: {
  email: string;
  code: string;
  redirectTo: string;
  type?: 'magiclink' | 'recovery' | 'signup';
}) {
  saveRedirectTo(params.redirectTo);
  return finishAuthFlow('signInOTP', () => signInOTP(params), {
    emitSessionValid: params.type !== 'recovery',
  });
}
