import { omit } from 'lodash-es';
import { v4 as uuidv4 } from 'uuid';

import { ERROR_CODE } from '@/application/constants';
import {
  AccessLevel,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  DuplicatePageOptions,
  CreatePagePayload,
  CreatePageResponse,
  CreateSpacePayload,
  CreateSpaceWithInitialPagePayload,
  CreateSpaceWithInitialPageResponse,
  isLegacyCompatibleSpaceVisibility,
  legacySpacePermission,
  SpaceInvitePolicy,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  UpdatePagePayload,
  UpdateSpacePayload,
  ViewIconType,
} from '@/application/types';
import { getErrorMessage, isUnsupportedRouteError } from '@/utils/errors';
import { Log } from '@/utils/log';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

function isLosslessLegacyPermission(permission: SpacePermissionSettings): boolean {
  return (
    isLegacyCompatibleSpaceVisibility(permission.visibility) &&
    permission.owner_access_level === AccessLevel.FullAccess &&
    permission.member_default_access_level === AccessLevel.ReadAndWrite &&
    (permission.everyone_else_access_level === null || permission.everyone_else_access_level === undefined) &&
    permission.invite_policy === SpaceInvitePolicy.OwnersOnly &&
    permission.sidebar_edit_policy === SpaceSidebarEditPolicy.OwnersOnly &&
    permission.invite_link_enabled === false &&
    permission.security.disable_guests === false &&
    permission.security.disable_public_links === false &&
    permission.security.disable_export === false
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };

  return (
    candidate.code === ERROR_CODE.RECORD_ALREADY_EXISTS ||
    candidate.response?.data?.code === ERROR_CODE.RECORD_ALREADY_EXISTS ||
    candidate.httpStatus === 409 ||
    candidate.response?.status === 409
  );
}

function mayHaveCommittedMutation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };
  const code = candidate.code ?? candidate.response?.data?.code;
  const explicitHttpStatus = candidate.httpStatus ?? candidate.response?.status;
  const httpStatus =
    typeof explicitHttpStatus === 'number'
      ? explicitHttpStatus
      : typeof code === 'number' && code >= 100 && code <= 599
      ? code
      : undefined;

  return (
    (code === undefined && httpStatus === undefined) ||
    code === -1 ||
    httpStatus === 408 ||
    httpStatus === 409 ||
    (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599)
  );
}

function isMissingOrDeletedResource(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };
  const code = candidate.code ?? candidate.response?.data?.code;
  const httpStatus = candidate.httpStatus ?? candidate.response?.status;

  return (
    code === ERROR_CODE.RECORD_NOT_FOUND ||
    code === ERROR_CODE.RECORD_DELETED ||
    httpStatus === 404 ||
    httpStatus === 410
  );
}

function withClientGeneratedCleanupOutcome(error: unknown, succeeded: boolean): unknown {
  const annotation = { clientGeneratedCleanupSucceeded: succeeded };

  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    try {
      return Object.assign(error, annotation);
    } catch {
      // A frozen error still needs to carry the reconciliation outcome.
    }
  }

  const candidate = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};

  return {
    ...candidate,
    code: typeof candidate.code === 'number' ? candidate.code : -1,
    message: getErrorMessage(error),
    ...annotation,
  };
}

function assertClientGeneratedId(resource: 'space' | 'page', expected: string, actual: unknown): string {
  if (typeof actual === 'string' && actual.length > 0 && actual === expected) return actual;

  // The caller supplied this identity as the idempotency boundary. Handing a
  // different (or missing) ID to the editor can open a folder view whose
  // document collab lives under the requested ID, and makes retries target the
  // wrong resource. Treat a broken echo as an ambiguous response so the
  // composed flow compensates the caller-owned space instead.
  throw Object.assign(new Error(`Create ${resource} returned an unexpected view ID`), {
    code: -1,
    clientGeneratedExpectedViewId: expected,
    clientGeneratedReturnedViewId: actual,
  });
}

export async function addAppPage(
  workspaceId: string,
  parentViewId: string,
  { layout, name, page_data, view_id, prev_view_id }: CreatePagePayload
) {
  const url = `/api/workspace/${workspaceId}/page-view`;

  Log.debug('[addAppPage] request', { url, workspaceId, parentViewId, layout, name, prev_view_id });

  const response = await executeAPIRequest<CreatePageResponse>(() =>
    getAxios()?.post<APIResponse<CreatePageResponse>>(url, {
      parent_view_id: parentViewId,
      layout,
      name,
      page_data,
      // The backend otherwise generates a different document-collab ID from
      // an explicitly supplied folder-view ID. Keep both identities aligned
      // so opening the returned view loads the document that was just created.
      ...(view_id ? { view_id, collab_id: view_id } : {}),
      prev_view_id,
    })
  );

  if (view_id) assertClientGeneratedId('page', view_id, response.view_id);

  Log.debug('[addAppPage] response', { view_id: response.view_id, database_id: response.database_id });

  return response;
}

export async function updatePage(workspaceId: string, viewId: string, data: UpdatePagePayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}`;

  return executeAPIVoidRequest(() => getAxios()?.patch<APIResponse>(url, data));
}

export async function favoritePageView(
  workspaceId: string,
  viewId: string,
  isFavorite: boolean,
  isPinned: boolean = true
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/favorite`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { is_favorite: isFavorite, is_pinned: isPinned })
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

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, { icon }));
}

export async function updatePageName(workspaceId: string, viewId: string, name: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/update-name`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, { name }));
}

export async function duplicatePage(workspaceId: string, viewId: string, options: DuplicatePageOptions = {}) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/duplicate`;
  const payload: Record<string, unknown> = {};

  if (options.openAfterDuplicate !== undefined) payload.open_after_duplicate = options.openAfterDuplicate;
  if (options.includeChildren !== undefined) payload.include_children = options.includeChildren;
  if (options.parentViewId) payload.parent_view_id = options.parentViewId;
  if (options.suffix) payload.suffix = options.suffix;
  if (options.source !== undefined) payload.source = options.source;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url, payload));
}

export async function deleteTrash(workspaceId: string, viewId?: string) {
  if (viewId) {
    const url = `/api/workspace/${workspaceId}/trash/${viewId}`;

    return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
  } else {
    const url = `/api/workspace/${workspaceId}/delete-all-pages-from-trash`;

    return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
  }
}

export async function moveToTrash(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move-to-trash`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
}

export async function restorePage(workspaceId: string, viewId?: string) {
  const url = viewId
    ? `/api/workspace/${workspaceId}/page-view/${viewId}/restore-from-trash`
    : `/api/workspace/${workspaceId}/restore-all-pages-from-trash`;

  return executeAPIVoidRequest(() => getAxios()?.post<APIResponse>(url));
}

export async function movePageTo(workspaceId: string, viewId: string, parentViewId: string, prevViewId?: string | null) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/move`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      new_parent_view_id: parentViewId,
      prev_view_id: prevViewId,
    })
  );
}

export async function createSpace(workspaceId: string, payload: CreateSpacePayload): Promise<string> {
  if (payload.permission) {
    const url = `/api/workspace/${workspaceId}/spaces`;
    const {
      space_permission: _legacyPermission,
      client_generated_view_id: clientGeneratedViewId,
      ...structuredPayload
    } = payload;

    try {
      const data = await executeAPIRequest<{ view_id: string }>(() =>
        getAxios()?.post<APIResponse<{ view_id: string }>>(url, structuredPayload)
      );

      if (clientGeneratedViewId && payload.view_id) {
        assertClientGeneratedId('space', payload.view_id, data.view_id);
      }

      return data.view_id;
    } catch (error) {
      if (clientGeneratedViewId && payload.view_id && isAlreadyExistsError(error)) return payload.view_id;
      if (!isUnsupportedRouteError(error)) throw error;

      const { permission, ...legacyPayload } = payload;

      // Older servers do not expose the structured endpoint. Fall back only
      // when every requested setting equals the binary endpoint's defaults;
      // otherwise it would silently discard the draft ACL.
      if (!isLosslessLegacyPermission(permission)) {
        Log.warn('[createSpace] structured /spaces endpoint unavailable and permission has no lossless legacy form', {
          workspaceId,
          visibility: permission.visibility,
        });
        throw error;
      }

      Log.warn('[createSpace] structured /spaces endpoint unavailable, falling back to legacy /space', {
        workspaceId,
      });

      return createSpace(workspaceId, {
        ...legacyPayload,
        space_permission: legacySpacePermission(permission.visibility),
      });
    }
  }

  const url = `/api/workspace/${workspaceId}/space`;
  const { client_generated_view_id: clientGeneratedViewId, ...requestPayload } = payload;

  try {
    const data = await executeAPIRequest<{ view_id: string }>(() =>
      getAxios()?.post<APIResponse<{ view_id: string }>>(url, requestPayload)
    );

    if (clientGeneratedViewId && payload.view_id) {
      assertClientGeneratedId('space', payload.view_id, data.view_id);
    }

    return data.view_id;
  } catch (error) {
    if (clientGeneratedViewId && payload.view_id && isAlreadyExistsError(error)) return payload.view_id;
    throw error;
  }
}

export async function createSpaceWithInitialPage(workspaceId: string, payload: CreateSpaceWithInitialPagePayload) {
  if (payload.permission && !isLosslessLegacyPermission(payload.permission)) {
    // The legacy /v2/space endpoint only understands binary public/private
    // permissions. Compose the structured endpoints instead so richer ACLs are
    // never silently downgraded. This is compensating, not server-transactional.
    const clientGeneratedViewId = payload.client_generated_view_id === true;
    const ownsSpaceId = payload.view_id === undefined || clientGeneratedViewId;
    const requestedSpaceId = payload.view_id ?? uuidv4();
    const { initial_page, ...spacePayload } = payload;
    let spaceId: string;

    try {
      spaceId = await createSpace(workspaceId, {
        ...spacePayload,
        view_id: requestedSpaceId,
      });
    } catch (error) {
      // A transport failure can happen after the server commits. Because the
      // client generated a fresh ID, a best-effort trash operation also covers
      // that ambiguous outcome without risking a caller-owned existing space.
      if (ownsSpaceId && mayHaveCommittedMutation(error)) {
        const cleanupSucceeded = await removePartiallyCreatedSpace(workspaceId, requestedSpaceId, true);

        throw withClientGeneratedCleanupOutcome(error, cleanupSucceeded);
      }

      throw error;
    }

    try {
      const page = await addAppPage(workspaceId, spaceId, initial_page);

      return {
        space: { view_id: spaceId },
        page,
      };
    } catch (error) {
      // The Create Space draft supplies fresh stable IDs for both resources.
      // If the initial-page response was lost, an AlreadyExists retry confirms
      // that the exact requested page was committed.
      if (clientGeneratedViewId && initial_page.view_id && isAlreadyExistsError(error)) {
        return {
          space: { view_id: spaceId },
          page: { view_id: initial_page.view_id },
        };
      }

      if (ownsSpaceId) {
        const cleanupSucceeded = await removePartiallyCreatedSpace(workspaceId, spaceId, true);

        throw withClientGeneratedCleanupOutcome(error, cleanupSucceeded);
      }

      throw error;
    }
  }

  const url = `/api/workspace/${workspaceId}/v2/space`;
  const {
    client_generated_view_id: clientGeneratedViewId,
    permission,
    space_permission: requestedLegacyPermission,
    ...legacyPayload
  } = payload;
  const requestPayload = {
    ...legacyPayload,
    space_permission: permission ? legacySpacePermission(permission.visibility) : requestedLegacyPermission,
  };

  try {
    const result = await executeAPIRequest<CreateSpaceWithInitialPageResponse>(() =>
      getAxios()?.post<APIResponse<CreateSpaceWithInitialPageResponse>>(url, requestPayload)
    );

    if (clientGeneratedViewId && payload.view_id && payload.initial_page.view_id) {
      assertClientGeneratedId('space', payload.view_id, result.space.view_id);
      assertClientGeneratedId('page', payload.initial_page.view_id, result.page.view_id);
    }

    return result;
  } catch (error) {
    if (clientGeneratedViewId && payload.view_id && payload.initial_page.view_id && isAlreadyExistsError(error)) {
      return {
        space: { view_id: payload.view_id },
        page: { view_id: payload.initial_page.view_id },
      };
    }

    throw error;
  }
}

async function removePartiallyCreatedSpace(workspaceId: string, spaceId: string, permanently: boolean) {
  let absenceConfirmed = false;

  try {
    await moveToTrash(workspaceId, spaceId);
    absenceConfirmed = true;
  } catch (cleanupError) {
    if (isMissingOrDeletedResource(cleanupError)) {
      absenceConfirmed = true;
    } else {
      Log.error('[createSpaceWithInitialPage] Failed to clean up partially created structured space', {
        workspaceId,
        spaceId,
        cleanupError,
      });
    }
  }

  if (!permanently) return absenceConfirmed;

  try {
    await deleteTrash(workspaceId, spaceId);
    return true;
  } catch (cleanupError) {
    if (!isMissingOrDeletedResource(cleanupError)) {
      Log.error('[createSpaceWithInitialPage] Failed to permanently remove partially created structured space', {
        workspaceId,
        spaceId,
        cleanupError,
      });
    }

    // Once move-to-trash (or an already missing/deleted response) is
    // confirmed, the ID cannot remain as an active space. Permanent purge is
    // best-effort and must not make a later retry reuse a trashed tombstone.
    return absenceConfirmed;
  }
}

export async function updateSpace(workspaceId: string, payload: UpdateSpacePayload) {
  const url = `/api/workspace/${workspaceId}/space/${payload.view_id}`;
  const data = omit(payload, ['view_id', 'client_generated_view_id']);

  return executeAPIVoidRequest(() => getAxios()?.patch<APIResponse>(url, data));
}

export async function createDatabaseView(workspaceId: string, viewId: string, payload: CreateDatabaseViewPayload) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/database-view`;

  Log.debug('[createDatabaseView]', { url, workspaceId, viewId, payload });

  return executeAPIRequest<CreateDatabaseViewResponse>(() =>
    getAxios()?.post<APIResponse<CreateDatabaseViewResponse>>(url, {
      parent_view_id: payload.parent_view_id,
      prev_view_id: payload.prev_view_id,
      database_id: payload.database_id,
      layout: payload.layout,
      name: payload.name,
      embedded: payload.embedded ?? false,
    })
  );
}
