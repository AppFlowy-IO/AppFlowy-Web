/**
 * Cached/stateful API functions extracted from AFClientService.
 * These functions have real logic beyond simple passthrough (caching, state, transforms).
 * Module-level state replaces the singleton class instance state.
 */
import * as random from 'lib0/random';
import * as Y from 'yjs';

import { db, openCollabDB } from '@/application/db';
import { Log } from '@/utils/log';
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
  getView,
  signInWithUrl,
  uploadFileMultipart,
  cancelImportTask,
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
  signInWithMagicLink,
  signInWithPassword,
  signUpWithPassword,
} from '@/application/services/js-services/http';
import { emit, EventType } from '@/application/session';
import { afterAuth, AUTH_CALLBACK_URL, saveRedirectTo } from '@/application/session/sign_in';
import { getTokenParsed } from '@/application/session/token';
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

const _getAppViewInFlight = new Map<string, Promise<View>>();
const _getAppViewCache = new Map<string, { data: View; expiresAt: number }>();
const VIEW_CACHE_TTL_MS = 5000;
const ANONYMOUS_VIEW_CACHE_SCOPE = 'anonymous';

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
    return existing;
  }

  const request = getView(workspaceId, viewId)
    .then((result) => {
      writeAppViewCaches(workspaceId, viewId, result, userId);
      return result;
    })
    .finally(() => {
      _getAppViewInFlight.delete(key);
    });

  _getAppViewInFlight.set(key, request);
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
  return _getAppViewCache.get(getAppViewCacheKey(getCurrentAppViewCacheUserId(), workspaceId, viewId))?.data;
}

export async function getCachedAppViewFromDisk(workspaceId: string, viewId: string): Promise<View | undefined> {
  const userId = getCurrentAppViewCacheUserId();

  if (!userId) return undefined;

  const record = await db.app_view_cache.get([userId, workspaceId, viewId]);

  return record?.data;
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
    emit(EventType.SESSION_INVALID);
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

export async function importFileWithUpload(file: File, onProgress: (progress: number) => void) {
  const task = await createImportTask(file);

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
