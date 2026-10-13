import { ERROR_CODE } from '@/application/constants';
import { PageService, WorkspaceService } from '@/application/services/domains';
import { isUnsupportedRouteError } from '@/utils/errors';

import { getView } from './http/view-api';
import { SpaceCreationIntent, SpaceCreationResult } from './space-creation-intent';

function isMissing(error: unknown): boolean {
  const value = error as { code?: number; httpStatus?: number; response?: { status?: number } } | null;

  return value?.code === ERROR_CODE.RECORD_NOT_FOUND || value?.httpStatus === 404 || value?.response?.status === 404;
}

const DEFINITIVE_APPLICATION_REJECTIONS: readonly number[] = [
  ERROR_CODE.INVALID_REQUEST,
  ERROR_CODE.NOT_LOGGED_IN,
  ERROR_CODE.NOT_HAS_PERMISSION,
  ERROR_CODE.USER_UNAUTHORIZED,
];

/**
 * Whether a failed create request proves that this request created nothing.
 *
 * Validation, permission and other ordinary 4xx rejections are definitive. Lost responses,
 * timeouts (408), conflicts on the client-owned ID (409), server errors and unknown failures may
 * still commit, so their request must stay resumable. A definitive rejection of a resend says
 * nothing about an earlier attempt with the same ID, which may still commit.
 */
export function isDefinitiveCreationRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    clientGeneratedCleanupSucceeded?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };

  // The composed space + first-page request reports whether its compensation was confirmed.
  if (candidate.clientGeneratedCleanupSucceeded === true) return true;
  if (candidate.clientGeneratedCleanupSucceeded === false) return false;
  const code = candidate.code ?? candidate.response?.data?.code;
  const explicitHttpStatus = candidate.httpStatus ?? candidate.response?.status;
  const httpStatus =
    typeof explicitHttpStatus === 'number'
      ? explicitHttpStatus
      : typeof code === 'number' && code >= 100 && code <= 599
      ? code
      : undefined;

  if (httpStatus !== undefined) return httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 409;
  // HTTP 200 can carry an application error; only known rejection classes are definitive.
  return typeof code === 'number' && DEFINITIVE_APPLICATION_REJECTIONS.includes(code);
}

export type SpaceCreationAdmission = 'allowed' | 'denied' | 'unsupported' | 'unavailable';

/**
 * Read the current space-creation (B) decision before sending a new request.
 *
 * A server without the capability route predates B and decides by itself ('unsupported'), so
 * callers keep the legacy behaviour. Any other failure is 'unavailable'. The result is only an
 * admission hint; the server still checks authority when the space is created.
 */
export async function readSpaceCreationAdmission(workspaceId: string): Promise<SpaceCreationAdmission> {
  try {
    const capability = await WorkspaceService.getWorkspaceSpaceCreationCapabilities(workspaceId);

    return capability.can_create_space ? 'allowed' : 'denied';
  } catch (error) {
    return isUnsupportedRouteError(error) ? 'unsupported' : 'unavailable';
  }
}

/** Read the original identities before deciding whether any new creation is needed. */
export async function recoverSpaceCreation(
  workspaceId: string,
  intent: SpaceCreationIntent,
  assertCurrent: () => void
): Promise<SpaceCreationResult | undefined> {
  assertCurrent();
  try {
    await WorkspaceService.getSpacePermission(workspaceId, intent.payload.view_id);
    assertCurrent();
  } catch (error) {
    assertCurrent();
    if (isMissing(error)) return;
    throw error;
  }

  const spaceId = intent.payload.view_id;
  const initialPage = intent.initialPage;

  if (!initialPage) return { spaceId };
  try {
    const existing = await getView(workspaceId, initialPage.view_id, 0);

    assertCurrent();
    if (existing.view_id !== initialPage.view_id || existing.parent_view_id !== spaceId) {
      throw new Error('Recovered page does not belong to the original space');
    }

    return { spaceId, initialPageId: initialPage.view_id };
  } catch (error) {
    assertCurrent();
    if (!isMissing(error)) throw error;
  }

  // This is an existing-space page operation: the server checks current page
  // authority. B denial must not block recovery of an already created space.
  const page = await PageService.add(workspaceId, spaceId, initialPage);

  assertCurrent();
  if (page.view_id !== initialPage.view_id) throw new Error('Create page returned an unexpected view ID');
  return { spaceId, initialPageId: initialPage.view_id };
}
