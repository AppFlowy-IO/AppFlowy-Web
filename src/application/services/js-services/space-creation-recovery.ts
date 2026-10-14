import { t } from 'i18next';

import { ERROR_CODE } from '@/application/constants';
import { PageService, WorkspaceService } from '@/application/services/domains';
import { isUnsupportedRouteError } from '@/utils/errors';

import { getView } from './http/view-api';
import { SpaceCreationFirstPageProblem, SpaceCreationIntent, SpaceCreationResult } from './space-creation-intent';

function isMissing(error: unknown): boolean {
  const value = error as { code?: number; httpStatus?: number; response?: { status?: number } } | null;

  return value?.code === ERROR_CODE.RECORD_NOT_FOUND || value?.httpStatus === 404 || value?.response?.status === 404;
}

/**
 * The space exists, but the first page saved with the request is under another parent or was added
 * under an ID the server chose. Checking again can't change that (and would add one more page on a
 * server that ignores the requested ID), so the request can only be discarded.
 */
export class SpaceCreationFirstPageError extends Error {
  constructor(readonly problem: SpaceCreationFirstPageProblem) {
    super(t(problem === 'elsewhere' ? 'spaceCreation.firstPageElsewhere' : 'spaceCreation.firstPageUnconfirmed'));
    this.name = 'SpaceCreationFirstPageError';
  }
}

/**
 * A create request whose first-page step was answered with another ID: the space exists, and the
 * server added its first page under an ID it chose (it ignores the requested one). The request's
 * own ID check reports that; a space created under another ID is not this case.
 */
export function firstPageAddedUnderOtherId(error: unknown, initialPageId: string | undefined): boolean {
  if (!initialPageId || typeof error !== 'object' || error === null) return false;
  return (error as { clientGeneratedExpectedViewId?: unknown }).clientGeneratedExpectedViewId === initialPageId;
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
 * Whether a failed capability read is the server refusing this account (HTTP 403 or the
 * not-enough-permissions code, e.g. after leaving the workspace) rather than a check that could
 * not run. A refusal is an answer: creation stays unavailable and is explained as a denial.
 */
export function isSpaceCreationDenial(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; httpStatus?: unknown; response?: { status?: unknown } };

  return value.httpStatus === 403 || value.response?.status === 403 || value.code === ERROR_CODE.NOT_HAS_PERMISSION;
}

/**
 * Read the current space-creation (B) decision before sending a new request.
 *
 * A server without the capability route predates B and decides by itself ('unsupported'), so
 * callers keep the legacy behaviour. A refused read is 'denied'; any other failure is
 * 'unavailable'. The result is only an admission hint; the server still checks authority when
 * the space is created.
 */
export async function readSpaceCreationAdmission(workspaceId: string): Promise<SpaceCreationAdmission> {
  try {
    const capability = await WorkspaceService.getWorkspaceSpaceCreationCapabilities(workspaceId);

    return capability.can_create_space ? 'allowed' : 'denied';
  } catch (error) {
    if (isUnsupportedRouteError(error)) return 'unsupported';
    return isSpaceCreationDenial(error) ? 'denied' : 'unavailable';
  }
}

/** Read the original identities before deciding whether any new creation is needed. */
export async function recoverSpaceCreation(
  workspaceId: string,
  intent: SpaceCreationIntent,
  assertCurrent: () => void
): Promise<SpaceCreationResult | undefined> {
  assertCurrent();
  // Already found unresolvable: never read or add the first page again.
  if (intent.firstPageProblem) throw new SpaceCreationFirstPageError(intent.firstPageProblem);
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
    // The space exists, but the page saved with this request is not its first page.
    if (existing.view_id !== initialPage.view_id || existing.parent_view_id !== spaceId) {
      throw new SpaceCreationFirstPageError('elsewhere');
    }

    return { spaceId, initialPageId: initialPage.view_id };
  } catch (error) {
    assertCurrent();
    if (!isMissing(error)) throw error;
  }

  // This is an existing-space page operation: the server checks current page
  // authority. B denial must not block recovery of an already created space.
  let page: { view_id: string };

  try {
    page = await PageService.add(workspaceId, spaceId, initialPage);
  } catch (error) {
    assertCurrent();
    if (firstPageAddedUnderOtherId(error, initialPage.view_id)) throw new SpaceCreationFirstPageError('unconfirmed');
    throw error;
  }

  assertCurrent();
  // PageService.add already refuses another ID; this keeps the rule for any other answer.
  if (page.view_id !== initialPage.view_id) throw new SpaceCreationFirstPageError('unconfirmed');
  return { spaceId, initialPageId: initialPage.view_id };
}
