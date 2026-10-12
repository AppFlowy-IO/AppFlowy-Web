import { ERROR_CODE } from '@/application/constants';
import { PageService, WorkspaceService } from '@/application/services/domains';

import { getView } from './http/view-api';
import { SpaceCreationIntent, SpaceCreationResult } from './space-creation-intent';

function isMissing(error: unknown): boolean {
  const value = error as { code?: number; httpStatus?: number; response?: { status?: number } } | null;

  return value?.code === ERROR_CODE.RECORD_NOT_FOUND || value?.httpStatus === 404 || value?.response?.status === 404;
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
