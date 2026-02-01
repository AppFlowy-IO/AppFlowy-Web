import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import dayjs from 'dayjs';
import { omit } from 'lodash-es';
import { nanoid } from 'nanoid';

import { GlobalComment, Reaction } from '@/application/comment.type';
import { ERROR_CODE } from '@/application/constants';
import { initGrantService, refreshToken } from '@/application/services/js-services/http/gotrue';
import { parseGoTrueErrorFromUrl } from '@/application/services/js-services/http/gotrue-error';
import { blobToBytes } from '@/application/services/js-services/http/utils';
import {
  AFCloudConfig,
  AppOutlineResponse,
  WorkspaceMemberProfileUpdate,
} from '@/application/services/services.type';
import { getTokenParsed, invalidToken } from '@/application/session/token';
import {
  Template,
  TemplateCategory,
  TemplateCategoryFormValues,
  TemplateCreator,
  TemplateCreatorFormValues,
  TemplateSummary,
  UploadTemplatePayload,
} from '@/application/template.type';
import {
  AccessLevel,
  AFWebUser,
  AuthProvider,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePagePayload,
  CreatePageResponse,
  CreateSpacePayload,
  CreateWorkspacePayload,
  DatabaseCsvImportCreateResponse,
  DatabaseCsvImportRequest,
  DatabaseCsvImportStatusResponse,
  DatabaseId,
  FolderView,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  GetRequestAccessInfoResponse,
  GuestConversionCodeInfo,
  GuestInvitation,
  Invitation,
  IPeopleWithAccessType,
  MentionablePerson,
  PublishViewPayload,
  QuickNote,
  QuickNoteEditorData,
  RequestAccessInfoStatus,
  Role,
  RowId,
  SubscriptionInterval,
  SubscriptionPlan,
  Subscriptions,
  Types,
  UpdatePagePayload,
  UpdatePublishConfigPayload,
  UpdateSpacePayload,
  UpdateWorkspacePayload,
  UploadPublishNamespacePayload,
  User,
  View,
  ViewIconType,
  ViewId,
  ViewInfo,
  ViewLayout,
  Workspace,
  WorkspaceMember,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { RepeatedChatMessage } from '@/components/chat';
import { database_blob } from '@/proto/database_blob';
import { getAppFlowyFileUploadUrl, getAppFlowyFileUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { hasProAccessFromPlans } from '@/utils/subscription';

export * from './gotrue';

let axiosInstance: AxiosInstance | null = null;

export function getAxiosInstance() {
  return axiosInstance;
}

/**
 * Standard API response format from AppFlowy server
 */
interface APIResponse<T = unknown> {
  code: number;
  data?: T;
  message: string;
}

/**
 * Standardized error object with code and message
 */
interface APIError {
  code: number;
  message: string;
}

/**
 * Safely handles axios errors and returns a consistent error format
 * This ensures all API errors have a code property, even for network errors
 */
function handleAPIError(error: unknown): APIError {
  if (axios.isAxiosError(error)) {
    // Extract just the path from URL (no query params or sensitive data)
    const url = error.config?.url || 'unknown';

    // Network error (no response from server)
    if (!error.response) {
      return {
        code: -1,
        message: `${error.message || 'Network error'} [${url}]`,
      };
    }

    // Server responded with error status
    const errorData = error.response.data as { code?: number; message?: string } | undefined;

    return {
      code: errorData?.code ?? error.response.status,
      message: `${errorData?.message || error.message || 'Request failed'} [${url}]`,
    };
  }

  // Non-axios error
  return {
    code: -1,
    message: error instanceof Error ? error.message : 'Unknown error occurred',
  };
}

/**
 * Safely executes an axios request and handles errors consistently
 * Returns the response data if successful, or rejects with a standardized error
 */
async function executeAPIRequest<TResponseData = unknown>(
  request: () => Promise<AxiosResponse<APIResponse<TResponseData>> | undefined> | undefined
): Promise<TResponseData> {
  try {
    if (!axiosInstance) {
      return Promise.reject({
        code: -1,
        message: 'API service not initialized',
      });
    }

    const response = await request();

    if (!response) {
      return Promise.reject({
        code: -1,
        message: 'No response received from server',
      });
    }

    // Get the actual URL that was requested
    const requestUrl = response.request?.responseURL
      || (response.config?.baseURL && response.config?.url
        ? `${response.config.baseURL}${response.config.url}`
        : response.config?.url)
      || 'unknown';

    const method = response.config?.method?.toUpperCase() || 'UNKNOWN';

    Log.debug('[executeAPIRequest]', { method, url: requestUrl, response_data: response.data?.data, response_code: response.data?.code, response_message: response.data?.message });

    if (!response.data) {
      console.error('[executeAPIRequest] No response data received', response);
      return Promise.reject({
        code: -1,
        message: 'No response data received',
      });
    }

    if (response.data.code === 0) {
      // Type assertion needed because TypeScript can't infer that data exists when code === 0
      return response.data.data as TResponseData;
    }

    // Server returned an error response
    return Promise.reject({
      code: response.data.code,
      message: `${response.data.message || 'Request failed'} [${response.config?.url || 'unknown'}]`,
    });
  } catch (error) {
    return Promise.reject(handleAPIError(error));
  }
}

/**
 * Safely executes an axios request that returns void (no data)
 * Used for API calls that only need to check success/failure
 */
async function executeAPIVoidRequest(
  request: () => Promise<AxiosResponse<APIResponse> | undefined> | undefined
): Promise<void> {
  try {
    if (!axiosInstance) {
      return Promise.reject({
        code: -1,
        message: 'API service not initialized',
      });
    }

    const response = await request();

    if (!response) {
      return Promise.reject({
        code: -1,
        message: 'No response received from server',
      });
    }

    const requestUrl = response.config?.url || 'unknown';

    // Many "void" endpoints return 204 or a 2xx with an empty body. Treat any 2xx as success
    // unless the standard APIResponse envelope is present and indicates an error.
    if (response.status >= 200 && response.status < 300) {
      const responseData: unknown = response.data;

      if (
        responseData &&
        typeof responseData === 'object' &&
        'code' in responseData &&
        typeof (responseData as { code?: unknown }).code === 'number'
      ) {
        const data = responseData as APIResponse;

        if (data.code === 0) return;

        return Promise.reject({
          code: data.code,
          message: `${data.message || 'Request failed'} [${requestUrl}]`,
        });
      }

      return;
    }

    return Promise.reject({
      code: response.status,
      message: `${response.statusText || 'Request failed'} [${requestUrl}]`,
    });
  } catch (error) {
    return Promise.reject(handleAPIError(error));
  }
}

export function initAPIService(config: AFCloudConfig) {
  if (axiosInstance) {
    return;
  }

  axiosInstance = axios.create({
    baseURL: config.baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  initGrantService(config.gotrueURL);

  axiosInstance.interceptors.request.use(
    async (config) => {
      const token = getTokenParsed();

      if (!token) {
        Log.debug('[initAPIService][request] no token found, sending request without auth header', {
          url: config.url,
        });
        return config;
      }

      const isExpired = dayjs().isAfter(dayjs.unix(token.expires_at));

      let access_token = token.access_token;
      const refresh_token = token.refresh_token;

      if (isExpired) {
        try {
          const newToken = await refreshToken(refresh_token);

          access_token = newToken?.access_token || '';
        } catch (e) {
          console.warn('[initAPIService][request] refresh token failed, marking token invalid', {
            url: config.url,
            message: (e as Error)?.message,
          });
          invalidToken();
          return config;
        }
      }

      if (access_token) {
        Object.assign(config.headers, {
          Authorization: `Bearer ${access_token}`,
        });
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  const handleUnauthorized = async (error: unknown) => {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    if (status === 401) {
      const token = getTokenParsed();

      if (!token) {
        console.warn('[initAPIService][response] 401 without token, emitting invalid token');
        invalidToken();
        return Promise.reject(error);
      }

      const refresh_token = token.refresh_token;

      try {
        await refreshToken(refresh_token);
      } catch (e) {
        console.warn('[initAPIService][response] refresh on 401 failed, emitting invalid token', {
          message: (e as Error)?.message,
          url: axiosError.config?.url,
        });
        invalidToken();
      }
    }

    return Promise.reject(error);
  };

  axiosInstance.interceptors.response.use((response) => response, handleUnauthorized);
}

export async function signInWithUrl(url: string) {
  // First check for GoTrue errors in the URL
  const gotrueError = parseGoTrueErrorFromUrl(url);

  if (gotrueError) {
    console.warn('[signInWithUrl] GoTrue error detected in callback URL', {
      code: gotrueError.code,
      message: gotrueError.message,
    });
    // GoTrue returned an error, reject with parsed error
    return Promise.reject({
      code: gotrueError.code,
      message: gotrueError.message,
    });
  }

  // No errors found, proceed with normal token extraction
  const urlObj = new URL(url);
  const hash = urlObj.hash;

  if (!hash) {
    console.warn('[signInWithUrl] No hash found in callback URL');
    return Promise.reject('No hash found');
  }

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (!accessToken || !refresh_token) {
    console.warn('[signInWithUrl] Missing tokens in callback hash', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refresh_token,
    });
    return Promise.reject({
      code: -1,
      message: 'No access token or refresh token found',
    });
  }

  // CRITICAL: Clear old token BEFORE processing new OAuth tokens
  // This prevents axios interceptor from trying to auto-refresh the old expired token
  // during verifyToken() API call, which would cause a race condition where:
  // 1. verifyToken() makes API call with NEW token in URL
  // 2. Axios interceptor sees OLD token in localStorage, tries to refresh it
  // 3. Old token refresh fails → invalidToken() called → session invalidated
  // 4. Meanwhile, OAuth flow is trying to save NEW token → conflicts with invalidation
  // By clearing the old token first, we ensure axios interceptor skips auto-refresh
  const hadOldToken = !!localStorage.getItem('token');

  if (hadOldToken) {
    Log.debug('[signInWithUrl] Clearing old token before processing OAuth callback to prevent race condition');
    localStorage.removeItem('token');
  }

  try {
    await verifyToken(accessToken);
  } catch (e) {
    console.warn('[signInWithUrl] Verify token failed', { message: (e as Error)?.message });
    return Promise.reject({
      code: -1,
      message: 'Verify token failed',
    });
  }

  try {
    await refreshToken(refresh_token);
  } catch (e) {
    console.warn('[signInWithUrl] Refresh token failed', { message: (e as Error)?.message });
    return Promise.reject({
      code: -1,
      message: 'Refresh token failed',
    });
  }
}

export async function verifyToken(accessToken: string) {
  const url = `/api/user/verify/${accessToken}`;

  return executeAPIRequest<{ is_new: boolean }>(() =>
    axiosInstance?.get<APIResponse<{ is_new: boolean }>>(url)
  );
}

export async function getAuthProviders(): Promise<AuthProvider[]> {
  const url = '/api/server-info/auth-providers';

  try {
    const payload = await executeAPIRequest<{
      count: number;
      providers: string[];
      signup_disabled: boolean;
      mailer_autoconfirm: boolean;
    }>(() =>
      axiosInstance?.get<APIResponse<{
        count: number;
        providers: string[];
        signup_disabled: boolean;
        mailer_autoconfirm: boolean;
      }>>(url)
    );

    return payload.providers
      .map((provider: string) => {
        switch (provider.toLowerCase()) {
          case 'google':
            return AuthProvider.GOOGLE;
          case 'apple':
            return AuthProvider.APPLE;
          case 'github':
            return AuthProvider.GITHUB;
          case 'discord':
            return AuthProvider.DISCORD;
          case 'email':
            return AuthProvider.EMAIL;
          case 'password':
            return AuthProvider.PASSWORD;
          case 'magic_link':
            return AuthProvider.MAGIC_LINK;
          case 'saml':
            return AuthProvider.SAML;
          case 'phone':
            return AuthProvider.PHONE;
          default:
            console.warn(`Unknown auth provider from server: ${provider}`);
            return null;
        }
      })
      .filter((provider): provider is AuthProvider => provider !== null);
  } catch (error) {
    const message = (error as APIError)?.message;

    console.warn('Auth providers API returned error:', message);
    console.error('Failed to fetch auth providers:', error);
    return [AuthProvider.PASSWORD];
  }
}

export async function getCurrentUser(workspaceId?: string): Promise<User> {
  const url = '/api/user/profile';

  try {
    const payload = await executeAPIRequest<{
      uid: number;
      uuid: string;
      email: string;
      name: string;
      metadata: Record<string, unknown>;
      encryption_sign: null;
      latest_workspace_id: string;
      updated_at: number;
    }>(() =>
      axiosInstance?.get<APIResponse<{
        uid: number;
        uuid: string;
        email: string;
        name: string;
        metadata: Record<string, unknown>;
        encryption_sign: null;
        latest_workspace_id: string;
        updated_at: number;
      }>>(url, {
        params: workspaceId ? { workspace_id: workspaceId } : {},
      })
    );

    const { uid, uuid, email, name, metadata } = payload;

    return {
      uid: String(uid),
      uuid,
      email,
      name,
      avatar: (metadata?.icon_url as string) || null,
      latestWorkspaceId: payload.latest_workspace_id,
      metadata: metadata || {},
    };
  } catch (error) {
    const apiError = error as APIError;

    if (apiError?.code === ERROR_CODE.USER_UNAUTHORIZED) {
      invalidToken();
      return Promise.reject(new Error('User unauthorized'));
    }

    return Promise.reject(apiError);
  }
}

export async function updateUserProfile(metadata: Record<string, unknown>): Promise<void> {
  const url = 'api/user/update';

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      metadata,
    })
  );
}

export async function getWorkspaceMemberProfile(workspaceId: string): Promise<MentionablePerson> {
  const url = `/api/workspace/${workspaceId}/workspace-profile`;

  return executeAPIRequest<MentionablePerson>(() =>
    axiosInstance?.get<APIResponse<MentionablePerson>>(url)
  );
}

export async function updateWorkspaceMemberProfile(
  workspaceId: string,
  profile: WorkspaceMemberProfileUpdate
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/update-member-profile`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, profile)
  );
}

interface AFWorkspace {
  workspace_id: string;
  owner_uid: number;
  owner_name: string;
  workspace_name: string;
  icon: string;
  created_at: string;
  member_count: number;
  database_storage_id: string;
  role?: Role;
}

function afWorkspace2Workspace(workspace: AFWorkspace): Workspace {
  return {
    id: workspace.workspace_id,
    owner: {
      uid: workspace.owner_uid,
      name: workspace.owner_name,
    },
    name: workspace.workspace_name,
    icon: workspace.icon,
    memberCount: workspace.member_count,
    databaseStorageId: workspace.database_storage_id,
    createdAt: workspace.created_at,
    role: workspace.role,
  };
}

export async function openWorkspace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/open`;

  return executeAPIVoidRequest(() => axiosInstance?.put<APIResponse>(url));
}

export async function updateWorkspace(workspaceId: string, payload: UpdateWorkspacePayload) {
  const url = `/api/workspace`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.patch<APIResponse>(url, {
      workspace_id: workspaceId,
      ...payload,
    })
  );
}

export async function createWorkspace(payload: CreateWorkspacePayload) {
  const url = '/api/workspace';

  return executeAPIRequest<{ workspace_id: string }>(() =>
    axiosInstance?.post<APIResponse<{ workspace_id: string }>>(url, payload)
  ).then((data) => data.workspace_id);
}

export async function getUserWorkspaceInfo(): Promise<{
  user_id: string;
  selected_workspace: Workspace;
  workspaces: Workspace[];
}> {
  const url = '/api/user/workspace';

  return executeAPIRequest<{
    user_profile: { uuid: string };
    visiting_workspace: AFWorkspace;
    workspaces: AFWorkspace[];
  }>(() =>
    axiosInstance?.get<APIResponse<{
      user_profile: { uuid: string };
      visiting_workspace: AFWorkspace;
      workspaces: AFWorkspace[];
    }>>(url)
  ).then((payload) => ({
    user_id: payload.user_profile.uuid,
    selected_workspace: afWorkspace2Workspace(payload.visiting_workspace),
    workspaces: payload.workspaces.map(afWorkspace2Workspace),
  }));
}

export async function publishView(workspaceId: string, viewId: string, payload?: PublishViewPayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/publish`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, payload)
  );
}

export async function unpublishView(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/unpublish`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url)
  );
}

export async function updatePublishNamespace(workspaceId: string, payload: UploadPublishNamespacePayload) {
  const url = `/api/workspace/${workspaceId}/publish-namespace`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, payload)
  );
}

export async function getPublishViewMeta(namespace: string, publishName: string) {
  const url = `/api/workspace/v1/published/${namespace}/${publishName}`;

  return executeAPIRequest<{
    view: ViewInfo;
    child_views: ViewInfo[];
    ancestor_views: ViewInfo[];
  }>(() =>
    axiosInstance?.get<APIResponse<{
      view: ViewInfo;
      child_views: ViewInfo[];
      ancestor_views: ViewInfo[];
    }>>(url)
  );
}

export async function getPublishViewBlob(namespace: string, publishName: string) {
  const url = `/api/workspace/published/${namespace}/${publishName}/blob`;

  try {
    const response = await axiosInstance?.get(url, {
      responseType: 'blob',
      validateStatus: (status) => status < 400, // Only accept success status codes
    });

    if (!response?.data) {
      console.error('[getPublishViewBlob] No response data received', response);
      const error: APIError = {
        code: -1,
        message: 'No response data received',
      };

      throw error;
    }

    return await blobToBytes(response.data);
  } catch (error) {
    throw handleAPIError(error);
  }
}

export async function updateCollab(
  workspaceId: string,
  objectId: string,
  collabType: Types,
  docState: Uint8Array,
  context: {
    version_vector: number;
  }
) {
  const url = `/api/workspace/v1/${workspaceId}/collab/${objectId}/web-update`;
  let deviceId = localStorage.getItem('x-device-id');

  if (!deviceId) {
    deviceId = nanoid(8);
    localStorage.setItem('x-device-id', deviceId);
  }

  await executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(
      url,
      {
        doc_state: Array.from(docState),
        collab_type: collabType,
      },
      {
        headers: {
          'client-version': 'web',
          'device-id': deviceId,
        },
      }
    )
  );

  return context;
}

/**
 * Batch sync multiple collab documents to the server.
 * This is the same API that desktop uses before duplicating to ensure
 * the server has the latest state of all documents.
 *
 * @param workspaceId - The workspace ID
 * @param items - Array of collab items to sync, each containing objectId, collabType, stateVector, and docState
 * @returns The batch sync response containing results for each collab
 */
export async function collabFullSyncBatch(
  workspaceId: string,
  items: Array<{
    objectId: string;
    collabType: Types;
    stateVector: Uint8Array;
    docState: Uint8Array;
  }>
): Promise<void> {
  const url = `/api/workspace/v1/${workspaceId}/collab/full-sync/batch`;

  // Import the collab proto types
  const { collab } = await import('@/proto/messages');

  // Build the protobuf request
  const request = collab.CollabBatchSyncRequest.create({
    items: items.map((item) => ({
      objectId: item.objectId,
      collabType: item.collabType,
      compression: collab.PayloadCompressionType.COMPRESSION_NONE,
      sv: item.stateVector,
      docState: item.docState,
    })),
    responseCompression: collab.PayloadCompressionType.COMPRESSION_NONE,
  });

  // Encode the request to binary
  const encoded = collab.CollabBatchSyncRequest.encode(request).finish();

  let deviceId = localStorage.getItem('x-device-id');

  if (!deviceId) {
    deviceId = nanoid(8);
    localStorage.setItem('x-device-id', deviceId);
  }

  // Send the request with protobuf content type
  const response = await axiosInstance?.post(url, encoded, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'client-version': 'web',
      'device-id': deviceId,
    },
    responseType: 'arraybuffer',
  });

  if (!response || response.status !== 200) {
    throw new Error(`Failed to sync collabs: ${response?.status}`);
  }

  // Decode and check the response for errors
  const responseData = new Uint8Array(response.data);
  const batchResponse = collab.CollabBatchSyncResponse.decode(responseData);

  // Check for any errors in the results
  for (const result of batchResponse.results) {
    if (result.error) {
      Log.warn('Collab sync error', {
        objectId: result.objectId,
        collabType: result.collabType,
        error: result.error,
      });
    }
  }
}

export async function getCollab(workspaceId: string, objectId: string, collabType: Types) {
  const url = `/api/workspace/v1/${workspaceId}/collab/${objectId}`;

  const data = await executeAPIRequest<{
    doc_state: number[];
    object_id: string;
  }>(() =>
    axiosInstance?.get<APIResponse<{
      doc_state: number[];
      object_id: string;
    }>>(url, {
      params: {
        collab_type: collabType,
      },
    })
  );

  return {
    data: new Uint8Array(data.doc_state),
  };
}

export async function getPageCollab(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}`;
  const response = await executeAPIRequest<{
    view: View;
    data: {
      encoded_collab: number[];
      row_data: Record<RowId, number[]>;
      owner?: User;
      last_editor?: User;
    };
  }>(() =>
    axiosInstance?.get<APIResponse<{
      view: View;
      data: {
        encoded_collab: number[];
        row_data: Record<RowId, number[]>;
        owner?: User;
        last_editor?: User;
      };
    }>>(url)
  );

  const { encoded_collab, row_data, owner, last_editor } = response.data;

  return {
    data: new Uint8Array(encoded_collab),
    rows: row_data,
    owner,
    lastEditor: last_editor,
  };
}

export async function databaseBlobDiff(
  workspaceId: string,
  databaseId: string,
  request: database_blob.IDatabaseBlobDiffRequest
) {
  if (!axiosInstance) {
    return Promise.reject({
      code: -1,
      message: 'API service not initialized',
    });
  }

  const url = `/api/workspace/${workspaceId}/database/${databaseId}/blob/diff`;
  const payload = database_blob.DatabaseBlobDiffRequest.encode(request).finish();

  const response = await axiosInstance.post<ArrayBuffer>(url, payload, {
    responseType: 'arraybuffer',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    transformRequest: [(data) => data],
    validateStatus: (status) => status === 200 || status === 202,
  });

  const bytes = new Uint8Array(response.data);

  return database_blob.DatabaseBlobDiffResponse.decode(bytes);
}

export async function getPublishView(publishNamespace: string, publishName: string) {
  const meta = await getPublishViewMeta(publishNamespace, publishName);
  const blob = await getPublishViewBlob(publishNamespace, publishName);

  if (meta.view.layout === ViewLayout.Document) {
    return {
      data: blob,
      meta,
    };
  }

  try {
    const decoder = new TextDecoder('utf-8');

    const jsonStr = decoder.decode(blob);

    const res = JSON.parse(jsonStr) as {
      database_collab: Uint8Array;
      database_row_collabs: Record<RowId, number[]>;
      database_row_document_collabs: Record<string, number[]>;
      visible_database_view_ids: ViewId[];
      database_relations: Record<DatabaseId, ViewId>;
    };

    return {
      data: new Uint8Array(res.database_collab),
      rows: res.database_row_collabs,
      visibleViewIds: res.visible_database_view_ids,
      relations: res.database_relations,
      subDocuments: res.database_row_document_collabs,
      meta,
    };
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function updatePublishConfig(workspaceId: string, payload: UpdatePublishConfigPayload) {
  const url = `/api/workspace/${workspaceId}/publish`;

  return executeAPIVoidRequest(() => axiosInstance?.patch<APIResponse>(url, [payload]));
}

export async function getPublishInfoWithViewId(viewId: string) {
  const url = `/api/workspace/v1/published-info/${viewId}`;

  return executeAPIRequest<{
    namespace: string;
    publish_name: string;
    publisher_email: string;
    view_id: string;
    publish_timestamp: string;
    comments_enabled: boolean;
    duplicate_enabled: boolean;
  }>(() =>
    axiosInstance?.get<APIResponse<{
      namespace: string;
      publish_name: string;
      publisher_email: string;
      view_id: string;
      publish_timestamp: string;
      comments_enabled: boolean;
      duplicate_enabled: boolean;
    }>>(url)
  );
}

export async function getAppFavorites(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/favorite`;

  return executeAPIRequest<{ views: View[] }>(() =>
    axiosInstance?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views);
}

export async function getAppTrash(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/trash`;

  return executeAPIRequest<{ views: View[] }>(() =>
    axiosInstance?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views);
}

export async function getAppRecent(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/recent`;

  return executeAPIRequest<{ views: View[] }>(() =>
    axiosInstance?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views);
}

export async function getAppOutline(workspaceId: string): Promise<AppOutlineResponse> {
  const url = `/api/workspace/${workspaceId}/folder?depth=10`;

  return executeAPIRequest<View>(() =>
    axiosInstance?.get<APIResponse<View>>(url)
  ).then((data) => ({
    outline: Array.isArray(data.children) ? data.children : [],
    folderRid: data.folder_rid,
  }));
}

export async function getView(workspaceId: string, viewId: string, depth: number = 1) {
  const url = `/api/workspace/${workspaceId}/folder?depth=${depth}&root_view_id=${viewId}`;

  return executeAPIRequest<View>(() =>
    axiosInstance?.get<APIResponse<View>>(url)
  );
}

export async function getPublishNamespace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/publish-namespace`;

  return executeAPIRequest<string>(() =>
    axiosInstance?.get<APIResponse<string>>(url)
  );
}

export async function getPublishHomepage(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/publish-default`;

  return executeAPIRequest<{
    namespace: string;
    publish_name: string;
    publisher_email: string;
    view_id: string;
  }>(() =>
    axiosInstance?.get<APIResponse<{
      namespace: string;
      publish_name: string;
      publisher_email: string;
      view_id: string;
    }>>(url)
  );
}

export async function updatePublishHomepage(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/publish-default`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, {
      view_id: viewId,
    })
  );
}

export async function removePublishHomepage(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/publish-default`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.delete<APIResponse>(url)
  );
}

export async function getPublishOutline(publishNamespace: string) {
  const url = `/api/workspace/published-outline/${publishNamespace}`;

  return executeAPIRequest<View>(() =>
    axiosInstance?.get<APIResponse<View>>(url)
  ).then((data) => data.children);
}

export async function getPublishViewComments(viewId: string): Promise<GlobalComment[]> {
  const url = `/api/workspace/published-info/${viewId}/comment`;
  const payload = await executeAPIRequest<{
    comments: {
      comment_id: string;
      user: {
        uuid: string;
        name: string;
        avatar_url: string | null;
      };
      content: string;
      created_at: string;
      last_updated_at: string;
      reply_comment_id: string | null;
      is_deleted: boolean;
      can_be_deleted: boolean;
    }[];
  }>(() =>
    axiosInstance?.get<APIResponse<{
      comments: {
        comment_id: string;
        user: {
          uuid: string;
          name: string;
          avatar_url: string | null;
        };
        content: string;
        created_at: string;
        last_updated_at: string;
        reply_comment_id: string | null;
        is_deleted: boolean;
        can_be_deleted: boolean;
      }[];
    }>>(url)
  );

  return payload.comments.map((comment) => ({
    commentId: comment.comment_id,
    user: {
      uuid: comment.user?.uuid || '',
      name: comment.user?.name || '',
      avatarUrl: comment.user?.avatar_url || null,
    },
    content: comment.content,
    createdAt: comment.created_at,
    lastUpdatedAt: comment.last_updated_at,
    replyCommentId: comment.reply_comment_id,
    isDeleted: comment.is_deleted,
    canDeleted: comment.can_be_deleted,
  }));
}

export async function getReactions(viewId: string, commentId?: string): Promise<Record<string, Reaction[]>> {
  let url = `/api/workspace/published-info/${viewId}/reaction`;

  if (commentId) {
    url += `?comment_id=${commentId}`;
  }

  const payload = await executeAPIRequest<{
    reactions: {
      reaction_type: string;
      react_users: {
        uuid: string;
        name: string;
        avatar_url: string | null;
      }[];
      comment_id: string;
    }[];
  }>(() =>
    axiosInstance?.get<APIResponse<{
      reactions: {
        reaction_type: string;
        react_users: {
          uuid: string;
          name: string;
          avatar_url: string | null;
        }[];
        comment_id: string;
      }[];
    }>>(url)
  );

  const reactionsMap: Record<string, Reaction[]> = {};

  for (const reaction of payload.reactions) {
    if (!reactionsMap[reaction.comment_id]) {
      reactionsMap[reaction.comment_id] = [];
    }

    reactionsMap[reaction.comment_id].push({
      reactionType: reaction.reaction_type,
      commentId: reaction.comment_id,
      reactUsers: reaction.react_users.map((user) => ({
        uuid: user.uuid,
        name: user.name,
        avatarUrl: user.avatar_url,
      })),
    });
  }

  return reactionsMap;
}

export async function createGlobalCommentOnPublishView(viewId: string, content: string, replyCommentId?: string) {
  const url = `/api/workspace/published-info/${viewId}/comment`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      content,
      reply_comment_id: replyCommentId,
    })
  );
}

export async function deleteGlobalCommentOnPublishView(viewId: string, commentId: string) {
  const url = `/api/workspace/published-info/${viewId}/comment`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.delete<APIResponse>(url, {
      data: {
        comment_id: commentId,
      },
    })
  );
}

export async function addReaction(viewId: string, commentId: string, reactionType: string) {
  const url = `/api/workspace/published-info/${viewId}/reaction`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      comment_id: commentId,
      reaction_type: reactionType,
    })
  );
}

export async function removeReaction(viewId: string, commentId: string, reactionType: string) {
  const url = `/api/workspace/published-info/${viewId}/reaction`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.delete<APIResponse>(url, {
      data: {
        comment_id: commentId,
        reaction_type: reactionType,
      },
    })
  );
}

export async function getWorkspaces(): Promise<Workspace[]> {
  const query = new URLSearchParams({
    include_member_count: 'true',
  });

  const url = `/api/workspace?${query.toString()}`;
  const payload = await executeAPIRequest<AFWorkspace[]>(() =>
    axiosInstance?.get<APIResponse<AFWorkspace[]>>(url)
  );

  return payload.map(afWorkspace2Workspace);
}

export interface WorkspaceFolder {
  view_id: string;
  icon: string | null;
  name: string;
  is_space: boolean;
  is_private: boolean;
  access_level?: AccessLevel;
  extra: {
    is_space: boolean;
    space_created_at: number;
    space_icon: string;
    space_icon_color: string;
    space_permission: number;
  };

  children: WorkspaceFolder[];
}

function iterateFolder(folder: WorkspaceFolder): FolderView {
  return {
    id: folder.view_id,
    name: folder.name,
    icon: folder.icon,
    isSpace: folder.is_space,
    extra: folder.extra ? JSON.stringify(folder.extra) : null,
    isPrivate: folder.is_private,
    accessLevel: folder.access_level,
    children: folder.children.map((child: WorkspaceFolder) => {
      return iterateFolder(child);
    }),
  };
}

export async function getWorkspaceFolder(workspaceId: string): Promise<FolderView> {
  const url = `/api/workspace/${workspaceId}/folder`;
  const payload = await executeAPIRequest<WorkspaceFolder>(() =>
    axiosInstance?.get<APIResponse<WorkspaceFolder>>(url)
  );

  return iterateFolder(payload);
}

export interface DuplicatePublishViewPayload {
  published_collab_type: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  published_view_id: string;
  dest_view_id: string;
}

export interface DuplicatePublishViewResponse {
  view_id: string;
  /** Mapping of database_id -> list of view_ids for databases created during duplication */
  database_mappings: Record<string, string[]>;
}

export async function duplicatePublishView(workspaceId: string, payload: DuplicatePublishViewPayload): Promise<DuplicatePublishViewResponse> {
  const url = `/api/workspace/${workspaceId}/published-duplicate`;

  return executeAPIRequest<DuplicatePublishViewResponse>(() =>
    axiosInstance?.post<APIResponse<DuplicatePublishViewResponse>>(url, payload)
  );
}

export async function createTemplate(template: UploadTemplatePayload) {
  const url = '/api/template-center/template';

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, template)
  );
}

export async function updateTemplate(viewId: string, template: UploadTemplatePayload) {
  const url = `/api/template-center/template/${viewId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, template)
  );
}

export async function getTemplates({ categoryId, nameContains }: { categoryId?: string; nameContains?: string }) {
  const url = `/api/template-center/template`;

  return executeAPIRequest<{ templates: TemplateSummary[] }>(() =>
    axiosInstance?.get<APIResponse<{ templates: TemplateSummary[] }>>(url, {
      params: {
        category_id: categoryId,
        name_contains: nameContains,
      },
    })
  ).then((data) => data.templates);
}

export async function getTemplateById(viewId: string) {
  const url = `/api/template-center/template/${viewId}`;

  return executeAPIRequest<Template>(() =>
    axiosInstance?.get<APIResponse<Template>>(url)
  );
}

export async function deleteTemplate(viewId: string) {
  const url = `/api/template-center/template/${viewId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.delete<APIResponse>(url)
  );
}

export async function getTemplateCategories() {
  const url = '/api/template-center/category';

  return executeAPIRequest<{ categories: TemplateCategory[] }>(() =>
    axiosInstance?.get<APIResponse<{ categories: TemplateCategory[] }>>(url)
  ).then((data) => data.categories);
}

export async function addTemplateCategory(category: TemplateCategoryFormValues) {
  const url = '/api/template-center/category';

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, category)
  );
}

export async function updateTemplateCategory(id: string, category: TemplateCategoryFormValues) {
  const url = `/api/template-center/category/${id}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, category)
  );
}

export async function deleteTemplateCategory(categoryId: string) {
  const url = `/api/template-center/category/${categoryId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.delete<APIResponse>(url)
  );
}

export async function getTemplateCreators() {
  const url = '/api/template-center/creator';

  return executeAPIRequest<{ creators: TemplateCreator[] }>(() =>
    axiosInstance?.get<APIResponse<{ creators: TemplateCreator[] }>>(url)
  ).then((data) => data.creators);
}

export async function createTemplateCreator(creator: TemplateCreatorFormValues) {
  const url = '/api/template-center/creator';

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, creator)
  );
}

export async function updateTemplateCreator(creatorId: string, creator: TemplateCreatorFormValues) {
  const url = `/api/template-center/creator/${creatorId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, creator)
  );
}

export async function deleteTemplateCreator(creatorId: string) {
  const url = `/api/template-center/creator/${creatorId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.delete<APIResponse>(url)
  );
}

export async function uploadTemplateAvatar(file: File) {
  const url = '/api/template-center/avatar';
  const formData = new FormData();

  formData.append('avatar', file);

  const data = await executeAPIRequest<{ file_id: string }>(() =>
    axiosInstance?.request<APIResponse<{ file_id: string }>>({
      method: 'PUT',
      url,
      data: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  );

  return axiosInstance?.defaults.baseURL + '/api/template-center/avatar/' + data.file_id;
}

export async function getInvitation(invitationId: string) {
  const url = `/api/workspace/invite/${invitationId}`;

  return executeAPIRequest<Invitation>(() =>
    axiosInstance?.get<APIResponse<Invitation>>(url)
  );
}

export async function acceptInvitation(invitationId: string) {
  const url = `/api/workspace/accept-invite/${invitationId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url)
  );
}

export async function getRequestAccessInfo(requestId: string): Promise<GetRequestAccessInfoResponse> {
  const url = `/api/access-request/${requestId}`;

  const data = await executeAPIRequest<{
    request_id: string;
    workspace: AFWorkspace;
    requester: AFWebUser & {
      email: string;
    };
    view: View;
    status: RequestAccessInfoStatus;
  }>(() =>
    axiosInstance?.get<APIResponse<{
      request_id: string;
      workspace: AFWorkspace;
      requester: AFWebUser & {
        email: string;
      };
      view: View;
      status: RequestAccessInfoStatus;
    }>>(url)
  );

  return {
    ...data,
    workspace: afWorkspace2Workspace(data.workspace),
  };
}

export async function approveRequestAccess(requestId: string) {
  const url = `/api/access-request/${requestId}/approve`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      is_approved: true,
    })
  );
}

export async function sendRequestAccess(workspaceId: string, viewId: string) {
  const url = `/api/access-request`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      view_id: viewId,
    })
  );
}

export async function getSubscriptionLink(workspaceId: string, plan: SubscriptionPlan, interval: SubscriptionInterval) {
  const url = `/billing/api/v1/subscription-link`;

  return executeAPIRequest<string>(() =>
    axiosInstance?.get<APIResponse<string>>(url, {
      params: {
        workspace_subscription_plan: plan,
        recurring_interval: interval,
        workspace_id: workspaceId,
        success_url: window.location.href,
      },
    })
  );
}

export async function getSubscriptions() {
  const url = `/billing/api/v1/subscriptions`;

  return executeAPIRequest<Subscriptions>(() =>
    axiosInstance?.get<APIResponse<Subscriptions>>(url)
  );
}

export async function getWorkspaceSubscriptions(workspaceId: string) {
  try {
    const plans = await getActiveSubscription(workspaceId);
    const subscriptions = await getSubscriptions();

    return subscriptions?.filter((subscription) => plans?.includes(subscription.plan));
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function getActiveSubscription(workspaceId: string) {
  const url = `/billing/api/v1/active-subscription/${workspaceId}`;

  return executeAPIRequest<SubscriptionPlan[]>(() =>
    axiosInstance?.get<APIResponse<SubscriptionPlan[]>>(url)
  );
}

export async function createImportTask(file: File) {
  const url = `/api/import/create`;
  const fileName = file.name.split('.').slice(0, -1).join('.') || crypto.randomUUID();

  return executeAPIRequest<{ task_id: string; presigned_url: string }>(() =>
    axiosInstance?.post<APIResponse<{ task_id: string; presigned_url: string }>>(url, {
      workspace_name: fileName,
      content_length: file.size,
    })
  ).then((data) => ({
    taskId: data.task_id,
    presignedUrl: data.presigned_url,
  }));
}

export async function uploadImportFile(presignedUrl: string, file: File, onProgress: (progress: number) => void) {
  const response = await axios.put(presignedUrl, file, {
    onUploadProgress: (progressEvent) => {
      const { progress = 0 } = progressEvent;

      Log.debug(`Upload progress: ${progress * 100}%`);
      onProgress(progress);
    },
    headers: {
      'Content-Type': 'application/zip',
    },
  });

  if (response.status === 200) {
    return;
  }

  return Promise.reject({
    code: -1,
    message: `Upload file failed. ${response.statusText}`,
  });
}

export async function createDatabaseCsvImportTask(
  workspaceId: string,
  payload: DatabaseCsvImportRequest
): Promise<DatabaseCsvImportCreateResponse> {
  const url = `/api/workspace/${workspaceId}/database/import/csv`;

  return executeAPIRequest<DatabaseCsvImportCreateResponse>(() =>
    axiosInstance?.post<APIResponse<DatabaseCsvImportCreateResponse>>(url, payload)
  );
}

export async function uploadDatabaseCsvImportFile(
  presignedUrl: string,
  file: File,
  onProgress?: (progress: number) => void
) {
  const response = await axios.put(presignedUrl, file, {
    onUploadProgress: (progressEvent) => {
      if (!onProgress) return;
      const { progress = 0 } = progressEvent;

      Log.debug(`Upload progress: ${progress * 100}%`);
      onProgress(progress);
    },
    headers: {
      'Content-Type': 'text/csv',
    },
  });

  if (response.status === 200 || response.status === 204) {
    return;
  }

  return Promise.reject({
    code: -1,
    message: `Upload csv file failed. ${response.statusText}`,
  });
}

export async function getDatabaseCsvImportStatus(
  workspaceId: string,
  taskId: string
): Promise<DatabaseCsvImportStatusResponse> {
  const url = `/api/workspace/${workspaceId}/database/import/csv/${taskId}`;

  return executeAPIRequest<DatabaseCsvImportStatusResponse>(() =>
    axiosInstance?.get<APIResponse<DatabaseCsvImportStatusResponse>>(url)
  );
}

export async function cancelDatabaseCsvImportTask(workspaceId: string, taskId: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/database/import/csv/${taskId}/cancel`;

  return executeAPIVoidRequest(() => axiosInstance?.post<APIResponse>(url));
}

export async function createDatabaseView(
  workspaceId: string,
  viewId: string,
  payload: CreateDatabaseViewPayload
) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/database-view`;

  Log.debug('[createDatabaseView]', { url, workspaceId, viewId, payload });

  return executeAPIRequest<CreateDatabaseViewResponse>(() =>
    axiosInstance?.post<APIResponse<CreateDatabaseViewResponse>>(url, {
      parent_view_id: payload.parent_view_id,
      database_id: payload.database_id,
      layout: payload.layout,
      name: payload.name,
      embedded: payload.embedded ?? false,
    })
  );
}

export async function addAppPage(workspaceId: string, parentViewId: string, { layout, name }: CreatePagePayload) {
  const url = `/api/workspace/${workspaceId}/page-view`;

  Log.debug('[addAppPage] request', { url, workspaceId, parentViewId, layout, name });

  const response = await executeAPIRequest<CreatePageResponse>(() =>
    axiosInstance?.post<APIResponse<CreatePageResponse>>(url, {
      parent_view_id: parentViewId,
      layout,
      name,
    })
  );

  Log.debug('[addAppPage] response', { view_id: response.view_id, database_id: response.database_id });

  return response;
}

export async function updatePage(workspaceId: string, viewId: string, data: UpdatePagePayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.patch<APIResponse>(url, data)
  );
}

export async function updatePageIcon(
  workspaceId: string,
  viewId: string,
  icon: {
    ty: ViewIconType;
    value: string;
  }
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/update-icon`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, { icon })
  );
}

export async function updatePageName(workspaceId: string, viewId: string, name: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/update-name`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, { name })
  );
}

export async function deleteTrash(workspaceId: string, viewId?: string) {
  if (viewId) {
    const url = `/api/workspace/${workspaceId}/trash/${viewId}`;

    return executeAPIVoidRequest(() =>
      axiosInstance?.delete<APIResponse>(url)
    );
  } else {
    const url = `/api/workspace/${workspaceId}/delete-all-pages-from-trash`;

    return executeAPIVoidRequest(() =>
      axiosInstance?.post<APIResponse>(url)
    );
  }
}

export async function moveToTrash(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`;

  return executeAPIVoidRequest(() => axiosInstance?.post<APIResponse>(url));
}

export async function movePageTo(workspaceId: string, viewId: string, parentViewId: string, prevViewId?: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      new_parent_view_id: parentViewId,
      prev_view_id: prevViewId,
    })
  );
}

export async function restorePage(workspaceId: string, viewId?: string) {
  const url = viewId
    ? `/api/workspace/${workspaceId}/page-view/${viewId}/restore-from-trash`
    : `/api/workspace/${workspaceId}/restore-all-pages-from-trash`;

  return executeAPIVoidRequest(() => axiosInstance?.post<APIResponse>(url));
}

export async function createSpace(workspaceId: string, payload: CreateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space`;

  return executeAPIRequest<{ view_id: string }>(() =>
    axiosInstance?.post<APIResponse<{ view_id: string }>>(url, payload)
  ).then((data) => data.view_id);
}

export async function updateSpace(workspaceId: string, payload: UpdateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space/${payload.view_id}`;
  const data = omit(payload, ['view_id']);

  return executeAPIVoidRequest(() =>
    axiosInstance?.patch<APIResponse>(url, data)
  );
}

export async function uploadFile(
  workspaceId: string,
  viewId: string,
  file: File,
  onProgress?: (progress: number) => void
) {
  Log.debug('[UploadFile] starting', { fileName: file.name, fileSize: file.size });
  const url = getAppFlowyFileUploadUrl(workspaceId, viewId);

  // Check file size, if over 7MB, check subscription plan
  if (file.size > 7 * 1024 * 1024) {
    const plan = await getActiveSubscription(workspaceId);

    if (!hasProAccessFromPlans(plan)) {
      notify.error('Your file is over 7 MB limit of the Free plan. Upgrade for unlimited uploads.');

      return Promise.reject({
        code: 413,
        message: 'File size is too large. Please upgrade your plan for unlimited uploads.',
      });
    }
  }

  try {
    const response = await axiosInstance?.put<{
      code: number;
      message: string;
      data: {
        file_id: string;
      };
    }>(url, file, {
      onUploadProgress: (progressEvent) => {
        const { progress = 0 } = progressEvent;

        onProgress?.(progress);
      },
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (response?.data.code === 0) {
    Log.debug('[UploadFile] completed', { url });
      return getAppFlowyFileUrl(workspaceId, viewId, response?.data.data.file_id);
    }

    return Promise.reject(response?.data);
    // eslint-disable-next-line
  } catch (e: any) {
    if (e.response?.status === 413) {
      return Promise.reject({
        code: 413,
        message: 'File size is too large. Please upgrade your plan for unlimited uploads.',
      });
    }

    return Promise.reject(handleAPIError(e));
  }
}

export { uploadFileMultipart } from './multipart-upload';
export { MULTIPART_THRESHOLD } from './multipart-upload.types';
export type { MultipartUploadProgress } from './multipart-upload.types';

export async function inviteMembers(workspaceId: string, emails: string[]) {
  const url = `/api/workspace/${workspaceId}/invite`;

  const payload = emails.map((e) => ({
    email: e,
    role: Role.Member,
  }));

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, payload)
  );
}

export async function getMembers(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/member`;

  return executeAPIRequest<WorkspaceMember[]>(() =>
    axiosInstance?.get<APIResponse<WorkspaceMember[]>>(url)
  );
}

export async function leaveWorkspace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/leave`;

  return executeAPIVoidRequest(() => axiosInstance?.post<APIResponse>(url));
}

export async function deleteWorkspace(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}`;

  return executeAPIVoidRequest(() => axiosInstance?.delete<APIResponse>(url));
}

export async function getQuickNoteList(
  workspaceId: string,
  params: {
    offset?: number;
    limit?: number;
    searchTerm?: string;
  }
) {
  const url = `/api/workspace/${workspaceId}/quick-note`;
  const payload = await executeAPIRequest<{
    quick_notes: QuickNote[];
    has_more: boolean;
  }>(() =>
    axiosInstance?.get<APIResponse<{
      quick_notes: QuickNote[];
      has_more: boolean;
    }>>(url, {
      params: {
        offset: params.offset,
        limit: params.limit,
        search_term: params.searchTerm || undefined,
      },
    })
  );

  return {
    data: payload.quick_notes,
    has_more: payload.has_more,
  };
}

export async function createQuickNote(workspaceId: string, payload: QuickNoteEditorData[]): Promise<QuickNote> {
  const url = `/api/workspace/${workspaceId}/quick-note`;

  return executeAPIRequest<QuickNote>(() =>
    axiosInstance?.post<APIResponse<QuickNote>>(url, { data: payload })
  );
}

export async function updateQuickNote(workspaceId: string, noteId: string, payload: QuickNoteEditorData[]) {
  const url = `/api/workspace/${workspaceId}/quick-note/${noteId}`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, { data: payload })
  );
}

export async function deleteQuickNote(workspaceId: string, noteId: string) {
  const url = `/api/workspace/${workspaceId}/quick-note/${noteId}`;

  return executeAPIVoidRequest(() => axiosInstance?.delete<APIResponse>(url));
}

export async function cancelSubscription(workspaceId: string, plan: SubscriptionPlan, reason?: string) {
  const url = `/billing/api/v1/cancel-subscription`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      plan,
      sync: true,
      reason,
    })
  );
}

export async function searchWorkspace(workspaceId: string, query: string) {
  const url = `/api/search/${workspaceId}`;
  const payload = await executeAPIRequest<
    {
      object_id: string;
    }[]
  >(() =>
    axiosInstance?.get<APIResponse<{ object_id: string }[]>>(url, {
      params: { query },
    })
  );

  return payload.map((item) => item.object_id);
}

export async function getChatMessages(workspaceId: string, chatId: string, limit?: number | undefined) {
  const url = `/api/chat/${workspaceId}/${chatId}/message`;

  return executeAPIRequest<RepeatedChatMessage>(() =>
    axiosInstance?.get<APIResponse<RepeatedChatMessage>>(url, {
      params: { limit: limit },
    })
  );
}

export async function duplicatePage(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/duplicate`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {})
  );
}

export async function joinWorkspaceByInvitationCode(code: string) {
  const url = `/api/workspace/join-by-invite-code`;

  return executeAPIRequest<{ workspace_id: string }>(() =>
    axiosInstance?.post<APIResponse<{ workspace_id: string }>>(url, { code })
  ).then((data) => data.workspace_id);
}

export async function getWorkspaceInfoByInvitationCode(code: string) {
  const url = `/api/invite-code-info`;

  return executeAPIRequest<{
    workspace_id: string;
    workspace_name: string;
    workspace_icon_url: string;
    owner_name: string;
    owner_avatar: string;
    is_member: boolean;
    member_count: number;
  }>(() =>
    axiosInstance?.get<APIResponse<{
      workspace_id: string;
      workspace_name: string;
      workspace_icon_url: string;
      owner_name: string;
      owner_avatar: string;
      is_member: boolean;
      member_count: number;
    }>>(url, {
      params: { code },
    })
  );
}

export async function generateAISummaryForRow(workspaceId: string, payload: GenerateAISummaryRowPayload) {
  const url = `/api/ai/${workspaceId}/summarize_row`;

  return executeAPIRequest<{ text: string }>(() =>
    axiosInstance?.post<APIResponse<{ text: string }>>(url, {
      workspace_id: workspaceId,
      data: payload,
    })
  ).then((data) => data.text);
}

export async function generateAITranslateForRow(workspaceId: string, payload: GenerateAITranslateRowPayload) {
  const url = `/api/ai/${workspaceId}/translate_row`;
  const payloadResponse = await executeAPIRequest<{
    items: {
      [key: string]: string;
    }[];
  }>(() =>
    axiosInstance?.post<APIResponse<{
      items: {
        [key: string]: string;
      }[];
    }>>(url, {
      workspace_id: workspaceId,
      data: payload,
    })
  );

  return payloadResponse.items
    .map((item) => item.content)
    .filter((content) => content)
    .join(', ');
}

export async function createOrphanedView(workspaceId: string, payload: { document_id: string }): Promise<Uint8Array> {
  const url = `/api/workspace/${workspaceId}/orphaned-view`;

  // Server returns doc_state as Vec<u8> which is JSON encoded as number[]
  const docStateArray = await executeAPIRequest<number[] | null>(() =>
    axiosInstance?.post<APIResponse<number[] | null>>(url, payload)
  );

  // Validate the response - server must return a valid doc_state array
  if (!docStateArray || !Array.isArray(docStateArray)) {
    throw new Error('Server returned invalid doc_state');
  }

  return new Uint8Array(docStateArray);
}

export async function getGuestInvitation(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/guest-invite-code-info`;

  return executeAPIRequest<GuestInvitation>(() =>
    axiosInstance?.get<APIResponse<GuestInvitation>>(url, {
      params: { code },
    })
  );
}

export async function acceptGuestInvitation(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/join-by-guest-invite-code`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, { code })
  );
}

export async function approveTurnGuestToMember(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/approve-guest-conversion`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, { code })
  );
}

export async function getGuestToMemberConversionInfo(workspaceId: string, code: string) {
  const url = `/api/sharing/workspace/${workspaceId}/guest-conversion-code-info`;

  return executeAPIRequest<GuestConversionCodeInfo>(() =>
    axiosInstance?.get<APIResponse<GuestConversionCodeInfo>>(url, { params: { code } })
  );
}

export async function getMentionableUsers(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/mentionable-person`;
  const payload = await executeAPIRequest<{
    persons: MentionablePerson[];
  }>(() =>
    axiosInstance?.get<APIResponse<{ persons: MentionablePerson[] }>>(url)
  );

  return payload.persons;
}

export interface PageMentionUpdate {
  person_id: string;
  block_id?: string | null;
  row_id?: string | null;
  require_notification: boolean;
  view_name: string;
  ancestors?: string[] | null;
  view_layout?: number | null;
  is_row_document?: boolean;
}

export async function updatePageMention(workspaceId: string, viewId: string, data: PageMentionUpdate) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/page-mention`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, data)
  );
}

export async function addRecentPages(workspaceId: string, viewIds: string[]) {
  const url = `/api/workspace/${workspaceId}/add-recent-pages`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, {
      recent_view_ids: viewIds,
    })
  );
}

export async function checkIfCollabExists(workspaceId: string, objectId: string) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/collab-exists`;

  const payload = await executeAPIRequest<{ exists: boolean }>(() =>
    axiosInstance?.get<APIResponse<{ exists: boolean }>>(url)
  );

  return payload.exists;
}

export async function getShareDetail(workspaceId: string, viewId: string, ancestorViewIds: string[]) {
  const url = `api/sharing/workspace/${workspaceId}/view/${viewId}/access-details`;

  return executeAPIRequest<{
    view_id: string;
    shared_with: IPeopleWithAccessType[];
  }>(() =>
    axiosInstance?.post<APIResponse<{
      view_id: string;
      shared_with: IPeopleWithAccessType[];
    }>>(url, {
      ancestor_view_ids: ancestorViewIds,
    })
  );
}

export async function sharePageTo(workspaceId: string, viewId: string, emails: string[], accessLevel?: AccessLevel) {
  const url = `/api/sharing/workspace/${workspaceId}/view`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, {
      view_id: viewId,
      emails,
      access_level: accessLevel || AccessLevel.ReadOnly,
    })
  );
}

export async function revokeAccess(workspaceId: string, viewId: string, emails: string[]) {
  const url = `/api/sharing/workspace/${workspaceId}/view/${viewId}/revoke-access`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.post<APIResponse>(url, { emails })
  );
}

export async function turnIntoMember(workspaceId: string, email: string) {
  const url = `/api/workspace/${workspaceId}/member`;

  return executeAPIVoidRequest(() =>
    axiosInstance?.put<APIResponse>(url, {
      email,
      role: Role.Member,
    })
  );
}


export async function getShareWithMe(workspaceId: string): Promise<View> {
  const url = `/api/sharing/workspace/${workspaceId}/folder`;

  return executeAPIRequest<View>(() =>
    axiosInstance?.get<APIResponse<View>>(url)
  );
}
