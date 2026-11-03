import { ClientValidationError, clientValidationMessages } from '@/application/errors/client-validation-error';
import { getView } from '@/application/services/js-services/http/view-api';
import { View, ViewLayout } from '@/application/types';
import { assertDashboardViewCreationOnline } from '@/application/view-online-policy';
import { getDashboardOwner, isDatabaseContainer } from '@/application/view-utils';

export const FORM_DEEP_DUPLICATE_UNAVAILABLE_MESSAGE =
  clientValidationMessages.FORM_DEEP_DUPLICATE_UNAVAILABLE;

export const FORM_DEEP_DUPLICATE_CHECK_FAILED_MESSAGE =
  clientValidationMessages.FORM_DEEP_DUPLICATE_CHECK_FAILED;

const FORM_DEEP_DUPLICATE_PREFLIGHT_DEPTH = 50;

type LoadDuplicateSubtree = (workspaceId: string, viewId: string, depth: number) => Promise<View>;

function assertOwnedDescendantsOnline(view: View | null | undefined): void {
  const pending = view ? [view] : [];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();

    if (!current || visited.has(current.view_id)) continue;
    visited.add(current.view_id);
    if (getDashboardOwner(current)) assertDashboardViewCreationOnline();
    pending.push(...current.children);
  }
}

/**
 * Generic page duplication is server-driven and currently rejects Form views
 * because it cannot preserve their configuration stored in the database Y.Doc.
 * Database-tab duplication has a separate, Form-aware path and must not use
 * this guard.
 */
export function isUnsafeFormDeepDuplicate(view: View | null | undefined): boolean {
  if (!view) return false;
  const pending = [view];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();

    if (!current || visited.has(current.view_id)) continue;
    visited.add(current.view_id);
    if (current.layout === ViewLayout.Form) return true;
    pending.push(...current.children);
  }

  return false;
}

export async function assertGenericDeepDuplicateIsSafe({
  workspaceId,
  viewId,
  knownView,
  loadFreshView = getView,
}: {
  workspaceId: string;
  viewId: string;
  knownView?: View | null;
  loadFreshView?: LoadDuplicateSubtree;
}): Promise<void> {
  assertOwnedDescendantsOnline(knownView);
  if (isUnsafeFormDeepDuplicate(knownView)) {
    throw new ClientValidationError('FORM_DEEP_DUPLICATE_UNAVAILABLE');
  }

  let freshView: View;

  try {
    // Generic page duplication includes descendants. Refresh a deep subtree
    // even when the selected page is a Document or Space: a nested database
    // may contain a Form that the generic server duplicate rejects.
    freshView = await loadFreshView(workspaceId, viewId, FORM_DEEP_DUPLICATE_PREFLIGHT_DEPTH);
  } catch {
    throw new ClientValidationError('FORM_DEEP_DUPLICATE_CHECK_FAILED');
  }

  if (isUnsafeFormDeepDuplicate(freshView)) {
    throw new ClientValidationError('FORM_DEEP_DUPLICATE_UNAVAILABLE');
  }

  assertOwnedDescendantsOnline(freshView);

  // Every database has at least one view. An empty container response means the
  // safety check did not receive the child metadata it needs, so fail closed.
  if (isDatabaseContainer(freshView) && freshView.children.length === 0) {
    throw new ClientValidationError('FORM_DEEP_DUPLICATE_CHECK_FAILED');
  }
}
