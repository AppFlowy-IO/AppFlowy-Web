/**
 * Cached/stateful API functions extracted from AFClientService.
 * These functions have real logic beyond simple passthrough (caching, state, transforms).
 * Module-level state replaces the singleton class instance state.
 */
import * as random from 'lib0/random';
import * as Y from 'yjs';

import { openCollabDB } from '@/application/db';
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
  createImportTask,
  uploadImportFile,
  publishView as publishViewAPI,
  unpublishView as unpublishViewAPI,
  updatePublishConfig as updatePublishConfigAPI,
  updatePublishNamespace as updatePublishNamespaceAPI,
  getCollab,
  getCurrentUser as getCurrentUserAPI,
  getUserWorkspaceInfo as getUserWorkspaceInfoAPI,
  duplicatePublishView as duplicatePublishViewAPI,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _getAppViewInFlight = new Map<string, Promise<any>>();
const _getAppViewCache = new Map<string, { data: unknown; expiresAt: number }>();
const VIEW_CACHE_TTL_MS = 5000;

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
export async function getAppViewCached(workspaceId: string, viewId: string) {
  const key = `${workspaceId}:${viewId}`;

  // 1. Return cached result if still fresh
  const cached = _getAppViewCache.get(key);

  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return cached.data;
    }

    // Eagerly evict expired entry
    _getAppViewCache.delete(key);
  }

  // 2. Share in-flight request if one exists
  const existing = _getAppViewInFlight.get(key);

  if (existing) {
    return existing;
  }

  // 3. Make the actual request
  const request = getView(workspaceId, viewId)
    .then((result) => {
      _getAppViewCache.set(key, {
        data: result,
        expiresAt: Date.now() + VIEW_CACHE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      _getAppViewInFlight.delete(key);
    });

  _getAppViewInFlight.set(key, request);
  return request;
}

export function invalidateViewCache(workspaceId: string, viewId: string) {
  const key = `${workspaceId}:${viewId}`;

  _getAppViewCache.delete(key);
  _getAppViewInFlight.delete(key);
}

export async function getPageDocCached(workspaceId: string, viewId: string, errorCallback?: (error: { code: number }) => void) {
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
  try {
    await signInWithUrl(url);
    emit(EventType.SESSION_VALID);
    afterAuth();
    return;
  } catch (e) {
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

export async function duplicatePublishViewTransformed(params: DuplicatePublishView): Promise<DuplicatePublishViewResponse> {
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

export async function uploadFileWithTracking(workspaceId: string, viewId: string, file: File, onProgress?: (progress: number) => void) {
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

  await uploadImportFile(task.presignedUrl, file, onProgress);
}

export async function publishViewClearingCache(workspaceId: string, viewId: string, payload?: PublishViewPayload) {
  if (publishViewInfo.has(viewId)) {
    publishViewInfo.delete(viewId);
  }

  return publishViewAPI(workspaceId, viewId, payload);
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
} from '@/application/services/js-services/http';

export async function signInGoogleWithRedirect(params: { redirectTo: string }) {
  const { signInGoogle } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInGoogle(AUTH_CALLBACK_URL);
}

export async function signInAppleWithRedirect(params: { redirectTo: string }) {
  const { signInApple } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInApple(AUTH_CALLBACK_URL);
}

export async function signInGithubWithRedirect(params: { redirectTo: string }) {
  const { signInGithub } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInGithub(AUTH_CALLBACK_URL);
}

export async function signInDiscordWithRedirect(params: { redirectTo: string }) {
  const { signInDiscord } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInDiscord(AUTH_CALLBACK_URL);
}

export async function signInSamlWithRedirect(params: { redirectTo: string; domain: string }): Promise<void> {
  const { signInSaml } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInSaml(AUTH_CALLBACK_URL, params.domain);
}

export async function signInWithPasswordWithRedirect(params: { email: string; password: string; redirectTo: string }) {
  const { signInWithPassword } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInWithPassword(params);
}

export async function signUpWithPasswordWithRedirect(params: { email: string; password: string; redirectTo: string }) {
  const { signUpWithPassword } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signUpWithPassword(params);
}

export async function signInMagicLinkWithRedirect({ email, redirectTo }: { email: string; redirectTo: string }) {
  const { signInWithMagicLink } = await import('@/application/services/js-services/http');

  saveRedirectTo(redirectTo);
  return signInWithMagicLink(email, AUTH_CALLBACK_URL);
}

export async function signInOTPWithRedirect(params: { email: string; code: string; redirectTo: string; type?: 'magiclink' | 'recovery' | 'signup' }) {
  const { signInOTP } = await import('@/application/services/js-services/http');

  saveRedirectTo(params.redirectTo);
  return signInOTP(params);
}
